//! Erkannten Text (OCR) unsichtbar in eine PDF schreiben, damit sie auch in anderen Programmen
//! durchsuchbar und auswaehlbar ist.
//!
//! Der Text kommt als eigener Inhaltsstrom hinter den vorhandenen Seiteninhalt, im Textmodus 3
//! (unsichtbar), mit Helvetica/WinAnsi. Der vorhandene Inhalt wird in `q ... Q` gefasst: ein
//! unausgewogener Grafikzustand der Seite darf unsere Positionen nicht verschieben.

use crate::{Error, Result};
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use serde::Deserialize;

/// Ein erkanntes Wort in den Koordinaten der *unrotierten* Seite (PDF-Benutzereinheiten):
/// Grundlinienanfang, Richtung der Grundlinie, Breite des Wortes, Schriftgroesse.
#[derive(Debug, Clone, Deserialize)]
pub struct Word {
    pub text: String,
    pub x: f64,
    pub y: f64,
    /// Winkel der Grundlinie in Grad (0 = nach rechts). Bei gedrehten Seiten nicht 0.
    #[serde(default)]
    pub angle: f64,
    pub width: f64,
    pub size: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PageText {
    /// 0-basiert
    pub page: usize,
    pub words: Vec<Word>,
}

/// Helvetica-Breiten (1/1000 em) fuer die WinAnsi-Bytes 32..=255.
const WIDTHS: [u16; 224] = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 761,
    556, 556, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 556, 611, 556,
    556, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 556, 500, 667,
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

fn winansi(c: char) -> Option<u8> {
    let cp = c as u32;
    match cp {
        0x20..=0x7E | 0xA0..=0xFF => Some(cp as u8),
        _ if c.is_whitespace() => Some(b' '),
        _ => Some(match c {
            '€' => 0x80, '‚' => 0x82, 'ƒ' => 0x83, '„' => 0x84, '…' => 0x85, '†' => 0x86, '‡' => 0x87,
            'ˆ' => 0x88, '‰' => 0x89, 'Š' => 0x8A, '‹' => 0x8B, 'Œ' => 0x8C, 'Ž' => 0x8E, '‘' => 0x91,
            '’' => 0x92, '“' => 0x93, '”' => 0x94, '•' => 0x95, '–' => 0x96, '—' => 0x97, '˜' => 0x98,
            '™' => 0x99, 'š' => 0x9A, '›' => 0x9B, 'œ' => 0x9C, 'ž' => 0x9E, 'Ÿ' => 0x9F,
            _ => return None,
        }),
    }
}

/// Bytes des Wortes (nicht darstellbare Zeichen entfallen) und seine natuerliche Breite in em.
fn encode(text: &str) -> (Vec<u8>, f64) {
    let bytes: Vec<u8> = text.chars().filter_map(winansi).collect();
    let em: f64 = bytes.iter().map(|&b| f64::from(WIDTHS[(b.max(32) - 32) as usize]) / 1000.0).sum();
    (bytes, em)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

fn content_for(words: &[Word]) -> Option<String> {
    let mut out = String::from("q\nBT\n3 Tr\n");
    let mut any = false;
    for w in words {
        let (mut bytes, em) = encode(&w.text);
        if bytes.is_empty() || em <= 0.0 || w.size <= 0.0 || w.width <= 0.0 {
            continue;
        }
        // Skalierung so, dass das Wort die erkannte Breite ausfuellt; ein Leerzeichen dahinter
        // trennt die Woerter beim Kopieren.
        let tz = (100.0 * w.width / (em * w.size)).clamp(10.0, 500.0);
        bytes.push(b' ');
        let (s, c) = w.angle.to_radians().sin_cos();
        out.push_str(&format!(
            "/FoOCR {:.3} Tf {:.2} Tz {:.5} {:.5} {:.5} {:.5} {:.3} {:.3} Tm <{}> Tj\n",
            w.size, tz, c, s, -s, c, w.x, w.y, hex(&bytes)
        ));
        any = true;
    }
    out.push_str("ET\nQ\n");
    any.then_some(out)
}

/// Das Wörterbuch, das `Resources` eines Seitenbaum-Knotens besitzt (die Seite selbst oder ein Vorfahr).
fn resources_owner(doc: &Document, page: ObjectId) -> ObjectId {
    let mut id = page;
    for _ in 0..64 {
        let Ok(dict) = doc.get_dictionary(id) else { break };
        if dict.has(b"Resources") {
            return id;
        }
        match dict.get(b"Parent").and_then(Object::as_reference) {
            Ok(parent) => id = parent,
            Err(_) => break,
        }
    }
    page
}

/// Traegt die Schrift `FoOCR` in die Ressourcen der Seite ein. Geerbte Ressourcen werden am
/// Besitzer ergaenzt (ein zusaetzlicher Schrifteintrag schadet den anderen Seiten nicht).
fn add_font(doc: &mut Document, page: ObjectId, font: ObjectId) -> Result<()> {
    let owner = resources_owner(doc, page);
    // Resources immer als eigenes Objekt, damit sich Direkt- und Verweisfall gleich behandeln lassen.
    let res_id = match doc.get_dictionary(owner)?.get(b"Resources") {
        Ok(Object::Reference(r)) => *r,
        Ok(Object::Dictionary(d)) => {
            let id = doc.add_object(Object::Dictionary(d.clone()));
            doc.get_object_mut(owner)?.as_dict_mut()?.set("Resources", Object::Reference(id));
            id
        }
        _ => {
            let id = doc.add_object(Object::Dictionary(dictionary! {}));
            doc.get_object_mut(owner)?.as_dict_mut()?.set("Resources", Object::Reference(id));
            id
        }
    };
    let font_dict_id = match doc.get_dictionary(res_id)?.get(b"Font") {
        Ok(Object::Reference(r)) => Some(*r),
        _ => None,
    };
    match font_dict_id {
        Some(fid) => doc.get_object_mut(fid)?.as_dict_mut()?.set("FoOCR", Object::Reference(font)),
        None => {
            let res = doc.get_object_mut(res_id)?.as_dict_mut()?;
            if let Ok(Object::Dictionary(fonts)) = res.get_mut(b"Font") {
                fonts.set("FoOCR", Object::Reference(font));
            } else {
                res.set("Font", Object::Dictionary(dictionary! { "FoOCR" => Object::Reference(font) }));
            }
        }
    }
    Ok(())
}

/// Seiteninhalt als Liste von Strom-Verweisen.
fn content_refs(doc: &Document, page: ObjectId) -> Vec<Object> {
    match doc.get_dictionary(page).ok().and_then(|d| d.get(b"Contents").ok()) {
        Some(Object::Reference(r)) => match doc.get_object(*r) {
            Ok(Object::Array(items)) => items.clone(),
            _ => vec![Object::Reference(*r)],
        },
        Some(Object::Array(items)) => items.clone(),
        _ => vec![],
    }
}

pub fn embed_text(bytes: &[u8], pages: &[PageText]) -> Result<Vec<u8>> {
    let mut doc = Document::load_mem(bytes)?;
    if doc.is_encrypted() {
        return Err(Error::Invalid("Verschluesselte PDFs koennen hier nicht bearbeitet werden.".into()));
    }
    let ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    let font = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => "WinAnsiEncoding",
    });
    let open = doc.add_object(Stream::new(dictionary! {}, b"q\n".to_vec()));
    let close = doc.add_object(Stream::new(dictionary! {}, b"\nQ\n".to_vec()));

    for p in pages {
        let id = *ids.get(p.page).ok_or_else(|| Error::Invalid(format!("Seite {} gibt es nicht.", p.page + 1)))?;
        let Some(content) = content_for(&p.words) else { continue };
        add_font(&mut doc, id, font)?;
        let ours = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
        let mut contents = vec![Object::Reference(open)];
        contents.extend(content_refs(&doc, id));
        contents.push(Object::Reference(close));
        contents.push(Object::Reference(ours));
        doc.get_object_mut(id)?.as_dict_mut()?.set("Contents", Object::Array(contents));
    }

    let mut out = Vec::with_capacity(bytes.len() + 4096);
    doc.save_to(&mut out)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::sample;

    fn word(text: &str, x: f64) -> Word {
        Word { text: text.into(), x, y: 100.0, angle: 0.0, width: 60.0, size: 12.0 }
    }

    #[test]
    fn encodes_winansi_and_drops_unsupported_characters() {
        assert_eq!(encode("Müller").0, vec![b'M', 0xFC, b'l', b'l', b'e', b'r']);
        assert_eq!(encode("Preis 5 €").0.last(), Some(&0x80));
        assert_eq!(encode("Привет").0, Vec::<u8>::new());
        assert_eq!(encode("a–b").0, vec![b'a', 0x96, b'b']);
        let (_, em) = encode("iiii");
        assert!((em - 4.0 * 0.222).abs() < 0.01, "{em}");
    }

    #[test]
    fn invisible_text_is_extractable_and_the_page_still_has_its_content() {
        let pdf = sample(3);
        let out = embed_text(&pdf, &[PageText { page: 1, words: vec![word("Hallo", 20.0), word("Welt", 90.0)] }]).unwrap();
        let doc = Document::load_mem(&out).unwrap();
        assert_eq!(doc.get_pages().len(), 3);
        let t = doc.extract_text(&[2]).unwrap();
        assert!(t.contains("Seite 2"), "{t:?}");
        assert!(t.contains("Hallo") && t.contains("Welt"), "{t:?}");
        // andere Seiten unberuehrt
        assert!(!doc.extract_text(&[1]).unwrap().contains("Hallo"));
        // Textmodus 3 = unsichtbar
        let page_id = *doc.get_pages().get(&2).unwrap();
        let content = String::from_utf8_lossy(&doc.get_page_content(page_id)).into_owned();
        assert!(content.contains("3 Tr"), "{content}");
    }

    #[test]
    fn rotated_words_get_a_rotated_matrix() {
        let w = Word { angle: 90.0, ..word("Quer", 50.0) };
        let c = content_for(&[w]).unwrap();
        assert!(c.contains("0.00000 1.00000 -1.00000 0.00000 50.000 100.000 Tm"), "{c}");
    }

    #[test]
    fn empty_or_invalid_input_is_ignored_or_rejected() {
        assert!(content_for(&[word("Привет", 1.0)]).is_none());
        let pdf = sample(1);
        let same = embed_text(&pdf, &[PageText { page: 0, words: vec![] }]).unwrap();
        assert_eq!(Document::load_mem(&same).unwrap().get_pages().len(), 1);
        assert!(embed_text(&pdf, &[PageText { page: 4, words: vec![word("x", 1.0)] }]).is_err());
    }

    #[test]
    fn works_when_resources_are_inherited_and_shared() {
        // sample() legt die Ressourcen am Seitenbaum ab, beide Seiten erben sie.
        let pdf = sample(2);
        let out = embed_text(&pdf, &[
            PageText { page: 0, words: vec![word("Eins", 10.0)] },
            PageText { page: 1, words: vec![word("Zwei", 10.0)] },
        ]).unwrap();
        let doc = Document::load_mem(&out).unwrap();
        assert!(doc.extract_text(&[1]).unwrap().contains("Eins"));
        assert!(doc.extract_text(&[2]).unwrap().contains("Zwei"));
    }
}
