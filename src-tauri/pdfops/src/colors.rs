//! Farben im Seiteninhalt in Grau umschreiben: `rg`/`RG`/`k`/`K` und `cs`+`sc` fuer RGB- und
//! CMYK-Farbraeume. Betrifft Seiten, Formulare (XObjects) und die Aussehen von Anmerkungen.
//!
//! Nicht umgewandelt werden Muster, Verlaeufe (`sh`), Sonderfarben (Separation/DeviceN) und
//! Lab: davon werden Seiten gezaehlt, damit der Aufrufer ehrlich warnen kann.

use crate::images::{space_of, Space};
use crate::{number, Report};
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Conv {
    None,
    Rgb,
    Cmyk,
}

fn lum(r: f64, g: f64, b: f64) -> f64 {
    (0.299 * r + 0.587 * g + 0.114 * b).clamp(0.0, 1.0)
}

fn cmyk_gray(c: f64, m: f64, y: f64, k: f64) -> f64 {
    lum((1.0 - c) * (1.0 - k), (1.0 - m) * (1.0 - k), (1.0 - y) * (1.0 - k))
}

fn real(v: f64) -> Object {
    Object::Real(((v * 10000.0).round() / 10000.0) as f32)
}

fn classify(doc: &Document, resources: &Dictionary, name: &[u8]) -> (Conv, bool) {
    match name {
        b"DeviceRGB" | b"RGB" | b"CalRGB" => (Conv::Rgb, false),
        b"DeviceCMYK" | b"CMYK" => (Conv::Cmyk, false),
        b"DeviceGray" | b"G" | b"CalGray" => (Conv::None, false),
        b"Pattern" => (Conv::None, true),
        _ => {
            let spaces = resources.get(b"ColorSpace").ok().and_then(|o| match o {
                Object::Reference(r) => doc.get_object(*r).ok(),
                other => Some(other),
            });
            let obj = spaces.and_then(|s| s.as_dict().ok()).and_then(|d| d.get(name).ok());
            match obj.and_then(|o| space_of(doc, o)) {
                Some(Space::Rgb) => (Conv::Rgb, false),
                Some(Space::Cmyk) => (Conv::Cmyk, false),
                Some(Space::Gray) => (Conv::None, false),
                // Palette: das Bild/der Farbwert bleibt, wie er ist; Sonderfarben, Lab usw. ebenso
                _ => (Conv::None, true),
            }
        }
    }
}

/// Schreibt den Inhalt um. `None`, wenn er sich nicht lesen laesst; sonst (neue Bytes, Anzahl nicht
/// umgewandelter Konstrukte).
fn rewrite(doc: &Document, content: &[u8], resources: &Dictionary) -> Option<(Vec<u8>, u32)> {
    let decoded = Content::decode(content).ok()?;
    let mut fill = Conv::None;
    let mut stroke = Conv::None;
    let mut stack: Vec<(Conv, Conv)> = Vec::new();
    let mut skipped = 0u32;
    let mut out: Vec<Operation> = Vec::with_capacity(decoded.operations.len());
    for mut op in decoded.operations {
        let nums: Vec<f64> = op.operands.iter().filter_map(number).collect();
        let all_numeric = nums.len() == op.operands.len();
        match op.operator.as_str() {
            "q" => stack.push((fill, stroke)),
            "Q" => {
                if let Some((f, s)) = stack.pop() {
                    fill = f;
                    stroke = s;
                }
            }
            "rg" | "RG" if all_numeric && nums.len() == 3 => {
                let lower = op.operator == "rg";
                op = Operation::new(if lower { "g" } else { "G" }, vec![real(lum(nums[0], nums[1], nums[2]))]);
                if lower { fill = Conv::None } else { stroke = Conv::None }
            }
            "k" | "K" if all_numeric && nums.len() == 4 => {
                let lower = op.operator == "k";
                op = Operation::new(if lower { "g" } else { "G" }, vec![real(cmyk_gray(nums[0], nums[1], nums[2], nums[3]))]);
                if lower { fill = Conv::None } else { stroke = Conv::None }
            }
            "cs" | "CS" => {
                let (conv, unsupported) = match op.operands.first().and_then(|o| o.as_name().ok()) {
                    Some(name) => classify(doc, resources, name),
                    None => (Conv::None, false),
                };
                if unsupported {
                    skipped += 1;
                }
                if conv != Conv::None {
                    op.operands = vec![Object::Name(b"DeviceGray".to_vec())];
                }
                if op.operator == "cs" { fill = conv } else { stroke = conv }
            }
            "sc" | "scn" | "SC" | "SCN" if all_numeric => {
                let conv = if op.operator.starts_with('s') { fill } else { stroke };
                let gray = match (conv, nums.len()) {
                    (Conv::Rgb, 3) => Some(lum(nums[0], nums[1], nums[2])),
                    (Conv::Cmyk, 4) => Some(cmyk_gray(nums[0], nums[1], nums[2], nums[3])),
                    _ => None,
                };
                if let Some(g) = gray {
                    op.operands = vec![real(g)];
                }
            }
            "sh" => skipped += 1,
            _ => {}
        }
        out.push(op);
    }
    let bytes = Content { operations: out }.encode().ok()?;
    Some((bytes, skipped))
}

/// Seiten, Formulare und Anmerkungsaussehen in Grau umschreiben.
pub(crate) fn grayscale(doc: &mut Document, report: &mut Report) {
    // Formulare (XObjects, auch die Aussehen der Anmerkungen)
    let forms: Vec<ObjectId> = doc
        .objects
        .iter()
        .filter_map(|(id, o)| match o {
            Object::Stream(s) if s.dict.get(b"Subtype").and_then(Object::as_name).is_ok_and(|n| n == b"Form") => Some(*id),
            _ => None,
        })
        .collect();
    for id in forms {
        let Some((resources, content)) = (match doc.get_object(id) {
            Ok(Object::Stream(s)) => {
                let res = s.dict.get(b"Resources").ok().and_then(|o| match o {
                    Object::Reference(r) => doc.get_object(*r).ok().and_then(|x| x.as_dict().ok()),
                    other => other.as_dict().ok(),
                });
                s.decompressed_content().ok().map(|c| (res.cloned().unwrap_or_default(), c))
            }
            _ => None,
        }) else { continue };
        if let Some((bytes, skipped)) = rewrite(doc, &content, &resources) {
            report.unconverted += skipped;
            if let Ok(Object::Stream(s)) = doc.get_object_mut(id) {
                s.dict.remove(b"Filter");
                s.dict.remove(b"DecodeParms");
                s.set_content(bytes);
                let _ = s.compress();
            }
        } else {
            report.unconverted += 1;
        }
    }

    // Seiteninhalt
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for page in pages {
        let resources = crate::inherited(doc, page, b"Resources").and_then(|o| o.as_dict().ok().cloned()).unwrap_or_default();
        let content = doc.get_page_content(page);
        match rewrite(doc, &content, &resources) {
            Some((bytes, skipped)) => {
                if skipped > 0 {
                    report.unconverted_pages += 1;
                }
                let mut stream = Stream::new(dictionary! {}, bytes);
                let _ = stream.compress();
                let id = doc.add_object(stream);
                if let Ok(Object::Dictionary(d)) = doc.get_object_mut(page) {
                    d.set("Contents", Object::Reference(id));
                }
            }
            None => report.unconverted_pages += 1,
        }
    }
}

#[cfg(test)]
pub(crate) fn rewrite_for_test(doc: &Document, content: &[u8], resources: &Dictionary) -> (Vec<u8>, u32) {
    rewrite(doc, content, resources).expect("Inhalt lesbar")
}
