//! Anmerkungen und Formularfelder "einbrennen": ihr Aussehen wird Teil des Seiteninhalts, die
//! Anmerkung selbst verschwindet. Danach laesst sich eine Unterschrift nicht mehr verschieben und
//! ein Textfeld nicht mehr aendern - das ist der Sinn, bevor man ein Dokument weitergibt.
//!
//! Links und Pop-ups bleiben. Anmerkungen ohne Aussehen (`/AP`) oder ausgeblendete bleiben
//! ebenfalls, damit nichts still verloren geht.

use crate::resources::{add_resource, append_content, brackets};
use crate::{number, rect_of, Report};
use lopdf::{Dictionary, Document, Object, ObjectId};

fn annotation_list(doc: &Document, page: ObjectId) -> Vec<Object> {
    match doc.get_dictionary(page).ok().and_then(|d| d.get(b"Annots").ok()) {
        Some(Object::Array(a)) => a.clone(),
        Some(Object::Reference(r)) => doc.get_object(*r).ok().and_then(|o| o.as_array().ok()).cloned().unwrap_or_default(),
        _ => vec![],
    }
}

/// Der Form-XObject, der gezeichnet werden soll (bei Zustandsverzeichnissen der aktuelle `/AS`).
fn appearance(doc: &Document, annot: &Dictionary) -> Option<ObjectId> {
    let ap = match annot.get(b"AP").ok()? {
        Object::Reference(r) => doc.get_object(*r).ok()?.as_dict().ok()?,
        other => other.as_dict().ok()?,
    };
    match ap.get(b"N").ok()? {
        Object::Reference(r) => match doc.get_object(*r).ok()? {
            Object::Stream(_) => Some(*r),
            Object::Dictionary(states) => pick(states, annot),
            _ => None,
        },
        Object::Dictionary(states) => pick(states, annot),
        _ => None,
    }
}

fn pick(states: &Dictionary, annot: &Dictionary) -> Option<ObjectId> {
    let state = annot.get(b"AS").ok()?.as_name().ok()?;
    states.get(state).ok()?.as_reference().ok()
}

/// Matrix, die das Aussehen auf das Rechteck der Anmerkung abbildet (PDF 32000, 12.5.5).
fn fit(doc: &Document, form: ObjectId, rect: [f64; 4]) -> Option<[f64; 6]> {
    let Object::Stream(s) = doc.get_object(form).ok()? else { return None };
    let bbox = rect_of(doc, s.dict.get(b"BBox").ok()?)?;
    let m: [f64; 6] = match s.dict.get(b"Matrix").ok() {
        Some(Object::Array(a)) if a.len() == 6 => {
            let v: Vec<f64> = a.iter().filter_map(number).collect();
            if v.len() == 6 { [v[0], v[1], v[2], v[3], v[4], v[5]] } else { [1.0, 0.0, 0.0, 1.0, 0.0, 0.0] }
        }
        _ => [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    };
    let corners = [(bbox[0], bbox[1]), (bbox[2], bbox[1]), (bbox[0], bbox[3]), (bbox[2], bbox[3])];
    let moved: Vec<(f64, f64)> = corners.iter().map(|&(x, y)| (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])).collect();
    let (x0, x1) = moved.iter().fold((f64::MAX, f64::MIN), |(a, b), p| (a.min(p.0), b.max(p.0)));
    let (y0, y1) = moved.iter().fold((f64::MAX, f64::MIN), |(a, b), p| (a.min(p.1), b.max(p.1)));
    if x1 - x0 < 1e-6 || y1 - y0 < 1e-6 {
        return None;
    }
    let sx = (rect[2] - rect[0]) / (x1 - x0);
    let sy = (rect[3] - rect[1]) / (y1 - y0);
    Some([sx, 0.0, 0.0, sy, rect[0] - x0 * sx, rect[1] - y0 * sy])
}

pub(crate) fn flatten(doc: &mut Document, report: &mut Report) {
    let wrap = brackets(doc);
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    let mut counter = 0usize;
    let mut left_widgets = false;
    for page in pages {
        let annots = annotation_list(doc, page);
        if annots.is_empty() {
            continue;
        }
        let mut keep = Vec::new();
        let mut content = String::new();
        let mut uses: Vec<(String, ObjectId)> = Vec::new();
        for entry in annots {
            let dict = match &entry {
                Object::Reference(r) => doc.get_object(*r).ok().and_then(|o| o.as_dict().ok()).cloned(),
                Object::Dictionary(d) => Some(d.clone()),
                _ => None,
            };
            let Some(dict) = dict else { keep.push(entry); continue };
            let subtype = dict.get(b"Subtype").and_then(Object::as_name).unwrap_or(b"").to_vec();
            let flags = dict.get(b"F").ok().and_then(|f| f.as_i64().ok()).unwrap_or(0);
            let hidden = flags & 2 != 0 || flags & 32 != 0; // Hidden, NoView
            let skip = matches!(subtype.as_slice(), b"Link" | b"Popup") || hidden;
            let target = if skip { None } else { appearance(doc, &dict) };
            let rect = dict.get(b"Rect").ok().and_then(|r| rect_of(doc, r));
            match target.zip(rect).and_then(|(t, r)| fit(doc, t, r).map(|m| (t, m))) {
                Some((form, m)) => {
                    counter += 1;
                    let name = format!("FoFlat{counter}");
                    content.push_str(&format!(
                        "q {:.5} {:.5} {:.5} {:.5} {:.4} {:.4} cm /{name} Do Q\n",
                        m[0], m[1], m[2], m[3], m[4], m[5]
                    ));
                    uses.push((name, form));
                    report.flattened += 1;
                }
                None => {
                    if subtype == b"Widget" {
                        left_widgets = true;
                    }
                    keep.push(entry);
                }
            }
        }
        if uses.is_empty() {
            continue;
        }
        for (name, form) in &uses {
            let _ = add_resource(doc, page, "XObject", name, *form);
        }
        let _ = append_content(doc, page, wrap, content.into_bytes());
        if let Ok(Object::Dictionary(d)) = doc.get_object_mut(page) {
            if keep.is_empty() { d.remove(b"Annots"); } else { d.set("Annots", Object::Array(keep)); }
        }
    }
    // Ohne Felder braucht das Dokument kein Formular mehr.
    if !left_widgets {
        if let Ok(catalog) = doc.catalog_mut() {
            catalog.remove(b"AcroForm");
        }
    } else {
        report.warnings.push("Einige Formularfelder haben kein Aussehen und blieben bestehen.".into());
    }
}
