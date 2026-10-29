//! Seitenweise Eingriffe: Drehen und Zuschneiden.
//!
//! PDF.js kann Seiten umordnen, loeschen und zusammenfuehren (`extractPages`), schreibt dabei
//! aber die Drehung und die Ausschnitte der Quellseiten unveraendert weiter. Das hier ergaenzt
//! genau diese beiden Dinge.

use crate::{inherited, number, rect_of, Error, Result};
use lopdf::{Document, Object};
use serde::Deserialize;

/// Seitenzahlen sind 0-basiert, wie in PDF.js.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Edit {
    /// Relativ zur bisherigen Drehung, in Vielfachen von 90 Grad (auch negativ).
    Rotate { pages: Vec<usize>, degrees: i32 },
    /// Sichtbarer Ausschnitt `[x0, y0, x1, y1]` im unrotierten Seitenkoordinatensystem (wie
    /// `viewport.convertToPdfPoint` es liefert), wird auf die vorhandene Seite beschnitten.
    Crop { pages: Vec<usize>, rect: [f64; 4] },
}

pub fn apply(bytes: &[u8], edits: &[Edit]) -> Result<Vec<u8>> {
    let mut doc = Document::load_mem(bytes)?;
    if doc.is_encrypted() {
        return Err(Error::Invalid("Verschluesselte PDFs koennen hier nicht bearbeitet werden.".into()));
    }
    let ids: Vec<_> = doc.get_pages().into_values().collect();

    for edit in edits {
        match edit {
            Edit::Rotate { pages, degrees } => {
                if degrees % 90 != 0 {
                    return Err(Error::Invalid(format!("Drehung {degrees} ist kein Vielfaches von 90 Grad.")));
                }
                for &p in pages {
                    let id = *ids.get(p).ok_or_else(|| Error::Invalid(format!("Seite {} gibt es nicht.", p + 1)))?;
                    let current = inherited(&doc, id, b"Rotate").and_then(|o| number(&o)).unwrap_or(0.0) as i32;
                    let next = (current + degrees).rem_euclid(360);
                    doc.get_object_mut(id)?.as_dict_mut()?.set("Rotate", Object::Integer(i64::from(next)));
                }
            }
            Edit::Crop { pages, rect } => {
                for &p in pages {
                    let id = *ids.get(p).ok_or_else(|| Error::Invalid(format!("Seite {} gibt es nicht.", p + 1)))?;
                    let media = inherited(&doc, id, b"MediaBox")
                        .and_then(|o| rect_of(&doc, &o))
                        .ok_or_else(|| Error::Invalid(format!("Seite {} hat keine MediaBox.", p + 1)))?;
                    // Gegen den bisher sichtbaren Bereich beschneiden, nicht gegen die ganze MediaBox:
                    // ein zweiter Zuschnitt darf die Seite nur verkleinern.
                    let visible = inherited(&doc, id, b"CropBox")
                        .and_then(|o| rect_of(&doc, &o))
                        .map(|c| [c[0].max(media[0]), c[1].max(media[1]), c[2].min(media[2]), c[3].min(media[3])])
                        .unwrap_or(media);
                    let r = [
                        rect[0].min(rect[2]).max(visible[0]),
                        rect[1].min(rect[3]).max(visible[1]),
                        rect[0].max(rect[2]).min(visible[2]),
                        rect[1].max(rect[3]).min(visible[3]),
                    ];
                    if r[2] - r[0] < 1.0 || r[3] - r[1] < 1.0 {
                        return Err(Error::Invalid(format!("Der Ausschnitt auf Seite {} ist leer oder liegt ausserhalb.", p + 1)));
                    }
                    let arr = r.iter().map(|v| Object::Real(*v as f32)).collect::<Vec<_>>();
                    doc.get_object_mut(id)?.as_dict_mut()?.set("CropBox", Object::Array(arr));
                }
            }
        }
    }

    let mut out = Vec::with_capacity(bytes.len() + 1024);
    doc.save_to(&mut out)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::sample;

    fn rotate_of(bytes: &[u8], page: usize) -> i64 {
        let doc = Document::load_mem(bytes).unwrap();
        let id = *doc.get_pages().values().nth(page).unwrap();
        inherited(&doc, id, b"Rotate").and_then(|o| o.as_i64().ok()).unwrap_or(0)
    }

    fn crop_of(bytes: &[u8], page: usize) -> Option<[f64; 4]> {
        let doc = Document::load_mem(bytes).unwrap();
        let id = *doc.get_pages().values().nth(page).unwrap();
        inherited(&doc, id, b"CropBox").and_then(|o| rect_of(&doc, &o))
    }

    #[test]
    fn rotates_only_the_named_pages_and_accumulates() {
        let pdf = sample(3);
        let once = apply(&pdf, &[Edit::Rotate { pages: vec![1], degrees: 90 }]).unwrap();
        assert_eq!([rotate_of(&once, 0), rotate_of(&once, 1), rotate_of(&once, 2)], [0, 90, 0]);
        let twice = apply(&once, &[Edit::Rotate { pages: vec![1, 2], degrees: -180 }]).unwrap();
        assert_eq!([rotate_of(&twice, 0), rotate_of(&twice, 1), rotate_of(&twice, 2)], [0, 270, 180]);
    }

    #[test]
    fn rotating_back_to_zero_overrides_an_inherited_value() {
        // Die Drehung steht im Seitenbaum, nicht an der Seite: der Zielwert muss trotzdem greifen.
        let pdf = sample(2);
        let mut doc = Document::load_mem(&pdf).unwrap();
        let pages_id = doc.catalog().unwrap().get(b"Pages").unwrap().as_reference().unwrap();
        doc.get_object_mut(pages_id).unwrap().as_dict_mut().unwrap().set("Rotate", 90);
        let mut tree = vec![];
        doc.save_to(&mut tree).unwrap();
        assert_eq!(rotate_of(&tree, 0), 90);
        let fixed = apply(&tree, &[Edit::Rotate { pages: vec![0], degrees: 270 }]).unwrap();
        assert_eq!([rotate_of(&fixed, 0), rotate_of(&fixed, 1)], [0, 90]);
    }

    #[test]
    fn rejects_non_right_angles_and_missing_pages() {
        let pdf = sample(1);
        assert!(apply(&pdf, &[Edit::Rotate { pages: vec![0], degrees: 45 }]).is_err());
        assert!(apply(&pdf, &[Edit::Rotate { pages: vec![5], degrees: 90 }]).is_err());
    }

    #[test]
    fn crop_is_clamped_to_the_page_and_can_only_shrink() {
        let pdf = sample(2);
        let first = apply(&pdf, &[Edit::Crop { pages: vec![0], rect: [-50.0, 20.0, 150.0, 400.0] }]).unwrap();
        assert_eq!(crop_of(&first, 0), Some([0.0, 20.0, 150.0, 300.0]));
        assert_eq!(crop_of(&first, 1), None);
        let second = apply(&first, &[Edit::Crop { pages: vec![0], rect: [100.0, 0.0, 200.0, 300.0] }]).unwrap();
        assert_eq!(crop_of(&second, 0), Some([100.0, 20.0, 150.0, 300.0]));
    }

    #[test]
    fn empty_crop_is_an_error_not_a_blank_page() {
        let pdf = sample(1);
        assert!(apply(&pdf, &[Edit::Crop { pages: vec![0], rect: [10.0, 10.0, 10.2, 200.0] }]).is_err());
        assert!(apply(&pdf, &[Edit::Crop { pages: vec![0], rect: [500.0, 500.0, 600.0, 600.0] }]).is_err());
    }

    #[test]
    fn page_count_and_text_survive_a_roundtrip() {
        let pdf = sample(4);
        let out = apply(&pdf, &[Edit::Rotate { pages: vec![0, 1, 2, 3], degrees: 90 }]).unwrap();
        let doc = Document::load_mem(&out).unwrap();
        assert_eq!(doc.get_pages().len(), 4);
        let text = doc.extract_text(&[3]).unwrap();
        assert!(text.contains("Seite 3"), "{text:?}");
    }
}
