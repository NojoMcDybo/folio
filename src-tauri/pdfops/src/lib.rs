//! PDF-Bearbeitung fuer Folio, ohne Oberflaeche und ohne Tauri - damit sie sich allein testen
//! und auch von der Kommandozeile (`folio.exe --compress ...`) aufrufen laesst.
//!
//! Alles arbeitet auf Bytes: Eingabe ist ein vollstaendiges PDF, Ergebnis ein neues. Das
//! Original wird nie angefasst; was damit geschieht (Sichern, Ablegen), entscheidet der Aufrufer.
//!
//! Lizenz der Bausteine: lopdf (MIT). Bewusst kein Ghostscript und kein MuPDF (beide AGPL).

use lopdf::{Dictionary, Document, Object, ObjectId};
use std::fmt;

pub mod files;
pub mod pages;
pub mod text;

pub use pages::{apply, Edit};

#[derive(Debug)]
pub enum Error {
    Pdf(String),
    Invalid(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Pdf(m) => write!(f, "PDF nicht lesbar oder nicht schreibbar: {m}"),
            Error::Invalid(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<lopdf::Error> for Error {
    fn from(e: lopdf::Error) -> Self {
        Error::Pdf(e.to_string())
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Pdf(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Eine geerbte Seiteneigenschaft (Rotate, MediaBox, CropBox ...) samt aufgeloester Referenz.
pub(crate) fn inherited(doc: &Document, page: ObjectId, key: &[u8]) -> Option<Object> {
    let mut id = page;
    for _ in 0..64 {
        let dict: &Dictionary = doc.get_dictionary(id).ok()?;
        if let Ok(value) = dict.get(key) {
            return Some(match value {
                Object::Reference(r) => doc.get_object(*r).ok()?.clone(),
                other => other.clone(),
            });
        }
        id = dict.get(b"Parent").ok()?.as_reference().ok()?;
    }
    None
}

pub(crate) fn number(o: &Object) -> Option<f64> {
    match o {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(f64::from(*r)),
        _ => None,
    }
}

/// Vier Zahlen eines Rechtecks, aufgeloest und normalisiert (x0 < x1, y0 < y1).
pub(crate) fn rect_of(doc: &Document, o: &Object) -> Option<[f64; 4]> {
    let arr = match o {
        Object::Array(a) => a.clone(),
        Object::Reference(r) => doc.get_object(*r).ok()?.as_array().ok()?.clone(),
        _ => return None,
    };
    if arr.len() != 4 {
        return None;
    }
    let mut v = [0.0; 4];
    for (i, item) in arr.iter().enumerate() {
        let item = match item {
            Object::Reference(r) => doc.get_object(*r).ok()?.clone(),
            other => other.clone(),
        };
        v[i] = number(&item)?;
    }
    Some([v[0].min(v[2]), v[1].min(v[3]), v[0].max(v[2]), v[1].max(v[3])])
}

#[cfg(test)]
pub(crate) mod testutil {
    use lopdf::content::{Content, Operation};
    use lopdf::{dictionary, Document, Object, Stream};

    /// Erzeugt ein PDF mit `n` Seiten (je 200 x 300 pt), auf jeder steht ihre Nummer.
    pub fn sample(n: usize) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" });
        let resources = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font } });
        let mut kids = vec![];
        for i in 0..n {
            let content = Content {
                operations: vec![
                    Operation::new("BT", vec![]),
                    Operation::new("Tf", vec!["F1".into(), 24.into()]),
                    Operation::new("Td", vec![20.into(), 250.into()]),
                    Operation::new("Tj", vec![Object::string_literal(format!("Seite {}", i + 1))]),
                    Operation::new("ET", vec![]),
                ],
            };
            let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
            let page_id = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "Contents" => content_id,
            });
            kids.push(page_id.into());
        }
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => kids,
                "Count" => n as i64,
                "Resources" => resources,
                "MediaBox" => vec![0.into(), 0.into(), 200.into(), 300.into()],
            }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        let mut out = vec![];
        doc.save_to(&mut out).unwrap();
        out
    }
}
