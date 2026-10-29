//! Bilder in der PDF: verkleinern (Zielaufloesung), neu komprimieren, in Graustufen umrechnen.
//!
//! Angefasst werden nur Bilder, bei denen das sicher geht: JPEG (DCT) und unkomprimierte oder
//! Flate-Bilder mit 8 Bit in Grau, RGB oder Palette. CMYK, JBIG2, CCITT, JPX, Stempelmasken,
//! Farbschluessel-Masken und Bilder mit Decode-Feld bleiben unveraendert.

use crate::{number, Report};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, ExtendedColorType, ImageBuffer, ImageFormat, Luma, Rgb};
use lopdf::content::Content;
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub(crate) enum Space {
    Gray,
    Rgb,
    Cmyk,
    Indexed { base: Box<Space>, lookup: Vec<u8> },
}

fn deref<'a>(doc: &'a Document, o: &'a Object) -> &'a Object {
    match o {
        Object::Reference(r) => doc.get_object(*r).unwrap_or(o),
        other => other,
    }
}

pub(crate) fn space_of(doc: &Document, o: &Object) -> Option<Space> {
    match deref(doc, o) {
        Object::Name(n) => match n.as_slice() {
            b"DeviceGray" | b"G" | b"CalGray" => Some(Space::Gray),
            b"DeviceRGB" | b"RGB" | b"CalRGB" => Some(Space::Rgb),
            b"DeviceCMYK" | b"CMYK" => Some(Space::Cmyk),
            _ => None,
        },
        Object::Array(a) => {
            let head = deref(doc, a.first()?).as_name().ok()?;
            match head {
                b"ICCBased" => match deref(doc, a.get(1)?).as_stream().ok()?.dict.get(b"N").ok()?.as_i64().ok()? {
                    1 => Some(Space::Gray),
                    3 => Some(Space::Rgb),
                    4 => Some(Space::Cmyk),
                    _ => None,
                },
                b"CalGray" => Some(Space::Gray),
                b"CalRGB" => Some(Space::Rgb),
                b"Indexed" | b"I" => {
                    let base = space_of(doc, a.get(1)?)?;
                    if matches!(base, Space::Indexed { .. } | Space::Cmyk) {
                        return None;
                    }
                    let lookup = match deref(doc, a.get(3)?) {
                        Object::String(s, _) => s.clone(),
                        Object::Stream(st) => st.decompressed_content().ok()?,
                        _ => return None,
                    };
                    Some(Space::Indexed { base: Box::new(base), lookup })
                }
                _ => None,
            }
        }
        _ => None,
    }
}

struct Raster {
    w: u32,
    h: u32,
    rgb: bool,
    data: Vec<u8>,
}

fn filters(dict: &Dictionary) -> Vec<Vec<u8>> {
    match dict.get(b"Filter") {
        Ok(Object::Name(n)) => vec![n.clone()],
        Ok(Object::Array(a)) => a.iter().filter_map(|o| o.as_name().ok().map(<[u8]>::to_vec)).collect(),
        _ => vec![],
    }
}

fn dim(dict: &Dictionary, key: &[u8]) -> Option<u32> {
    dict.get(key).ok()?.as_i64().ok().and_then(|v| u32::try_from(v).ok()).filter(|v| *v > 0)
}

fn ascii85(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(data.len() * 4 / 5);
    let mut group = [0u32; 5];
    let mut n = 0;
    let mut bytes = data.iter().copied().filter(|b| !b.is_ascii_whitespace()).peekable();
    if bytes.peek() == Some(&b'<') {
        bytes.next(); // optionales "<~"
        if bytes.peek() == Some(&b'~') { bytes.next(); }
    }
    for b in bytes {
        match b {
            b'~' => break,
            b'z' if n == 0 => out.extend_from_slice(&[0, 0, 0, 0]),
            b'!'..=b'u' => {
                group[n] = u32::from(b - b'!');
                n += 1;
                if n == 5 {
                    let v = group.iter().fold(0u32, |acc, &d| acc.wrapping_mul(85).wrapping_add(d));
                    out.extend_from_slice(&v.to_be_bytes());
                    n = 0;
                }
            }
            _ => return None,
        }
    }
    if n > 1 {
        for slot in group.iter_mut().skip(n) { *slot = 84; }
        let v = group.iter().fold(0u32, |acc, &d| acc.wrapping_mul(85).wrapping_add(d));
        out.extend_from_slice(&v.to_be_bytes()[..n - 1]);
    }
    Some(out)
}

fn ascii_hex(data: &[u8]) -> Option<Vec<u8>> {
    let digits: Vec<u8> = data.iter().copied().take_while(|b| *b != b'>').filter(|b| !b.is_ascii_whitespace()).collect();
    let nibble = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    digits.chunks(2).map(|p| Some((nibble(p[0])? << 4) | p.get(1).copied().map_or(Some(0), nibble)?)).collect()
}

/// Entfernt vorangestellte ASCII-Filter (reportlab und andere packen JPEG/Flate in ASCII85) und
/// liefert die restliche Filterkette samt Bytes.
fn unwrap_ascii(stream: &Stream) -> Option<(Vec<Vec<u8>>, Vec<u8>)> {
    let mut chain = filters(&stream.dict);
    let mut bytes = stream.content.clone();
    while let Some(first) = chain.first() {
        bytes = match first.as_slice() {
            b"ASCII85Decode" | b"A85" => ascii85(&bytes)?,
            b"ASCIIHexDecode" | b"AHx" => ascii_hex(&bytes)?,
            _ => break,
        };
        chain.remove(0);
    }
    Some((chain, bytes))
}

fn decode(stream: &Stream, space: &Space) -> Option<Raster> {
    let (w, h) = (dim(&stream.dict, b"Width")?, dim(&stream.dict, b"Height")?);
    let (chain, data) = unwrap_ascii(stream)?;
    match chain.as_slice() {
        [f] if f == b"DCTDecode" || f == b"DCT" => {
            let img = image::load_from_memory_with_format(&data, ImageFormat::Jpeg).ok()?;
            match (img.color(), space) {
                (image::ColorType::L8, Space::Gray) => Some(Raster { w: img.width(), h: img.height(), rgb: false, data: img.into_luma8().into_raw() }),
                (image::ColorType::Rgb8, Space::Rgb) => Some(Raster { w: img.width(), h: img.height(), rgb: true, data: img.into_rgb8().into_raw() }),
                _ => None,
            }
        }
        [] | [_] => {
            if chain.first().is_some_and(|f| f != b"FlateDecode" && f != b"Fl") {
                return None;
            }
            if stream.dict.get(b"BitsPerComponent").ok()?.as_i64().ok()? != 8 {
                return None;
            }
            let bytes = if chain.is_empty() {
                data
            } else {
                // Flate (ggf. mit Predictor) auf den entpackten Bytes
                let mut tmp = Stream::new(stream.dict.clone(), data);
                tmp.dict.set("Filter", Object::Name(b"FlateDecode".to_vec()));
                tmp.decompressed_content().ok()?
            };
            let pixels = (w as usize).checked_mul(h as usize)?;
            match space {
                Space::Gray if bytes.len() >= pixels => Some(Raster { w, h, rgb: false, data: bytes[..pixels].to_vec() }),
                Space::Rgb if bytes.len() >= pixels * 3 => Some(Raster { w, h, rgb: true, data: bytes[..pixels * 3].to_vec() }),
                Space::Indexed { base, lookup } if bytes.len() >= pixels => {
                    let comps = if matches!(**base, Space::Gray) { 1 } else { 3 };
                    let mut data = Vec::with_capacity(pixels * comps);
                    for &i in &bytes[..pixels] {
                        let at = i as usize * comps;
                        data.extend_from_slice(lookup.get(at..at + comps).unwrap_or(&[0, 0, 0][..comps]));
                    }
                    Some(Raster { w, h, rgb: comps == 3, data })
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn to_gray(r: &Raster) -> Raster {
    if !r.rgb {
        return Raster { w: r.w, h: r.h, rgb: false, data: r.data.clone() };
    }
    let data = r
        .data
        .chunks_exact(3)
        .map(|p| ((299 * u32::from(p[0]) + 587 * u32::from(p[1]) + 114 * u32::from(p[2]) + 500) / 1000) as u8)
        .collect();
    Raster { w: r.w, h: r.h, rgb: false, data }
}

fn shrink(r: &Raster, w: u32, h: u32) -> Raster {
    let filter = FilterType::Lanczos3;
    if r.rgb {
        let src = ImageBuffer::<Rgb<u8>, _>::from_raw(r.w, r.h, r.data.clone()).expect("Rastergroesse");
        Raster { w, h, rgb: true, data: image::imageops::resize(&src, w, h, filter).into_raw() }
    } else {
        let src = ImageBuffer::<Luma<u8>, _>::from_raw(r.w, r.h, r.data.clone()).expect("Rastergroesse");
        Raster { w, h, rgb: false, data: image::imageops::resize(&src, w, h, filter).into_raw() }
    }
}

fn jpeg(r: &Raster, quality: u8) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let color = if r.rgb { ExtendedColorType::Rgb8 } else { ExtendedColorType::L8 };
    JpegEncoder::new_with_quality(&mut out, quality.clamp(10, 100)).encode(&r.data, r.w, r.h, color).ok()?;
    Some(out)
}

fn flate(r: &Raster) -> Option<Vec<u8>> {
    let mut s = Stream::new(dictionary! {}, r.data.clone());
    s.compress().ok()?;
    s.dict.has(b"Filter").then_some(s.content)
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ImageOptions {
    pub dpi: Option<f32>,
    pub quality: u8,
    pub gray: bool,
}

fn transform(doc: &Document, id: ObjectId, o: &ImageOptions, shown: &HashMap<ObjectId, f64>) -> Option<Stream> {
    let Object::Stream(stream) = doc.get_object(id).ok()? else { return None };
    let d = &stream.dict;
    if d.get(b"Subtype").ok()?.as_name().ok()? != b"Image" {
        return None;
    }
    if d.get(b"ImageMask").ok().and_then(|m| m.as_bool().ok()).unwrap_or(false) || d.has(b"Decode") {
        return None;
    }
    // Farbschluessel-Maske (Array) haengt an exakten Pixelwerten; JPEG-Neuberechnung wuerde sie zerstoeren.
    if matches!(d.get(b"Mask"), Ok(Object::Array(_))) {
        return None;
    }
    let space = space_of(doc, d.get(b"ColorSpace").ok()?)?;
    if matches!(space, Space::Cmyk) {
        return None;
    }
    let was_jpeg = unwrap_ascii(stream).and_then(|(c, _)| c.first().cloned()).is_some_and(|f| f == b"DCTDecode" || f == b"DCT");
    let src = decode(stream, &space)?;

    let scale = match o.dpi {
        Some(target) => {
            // Wie breit erscheint das Bild? Gemessen im Seiteninhalt, sonst als Seitenbreite angenommen.
            let shown_pt = shown.get(&id).copied().filter(|w| *w > 1.0).unwrap_or(595.0);
            let effective = f64::from(src.w) / (shown_pt / 72.0);
            if effective > f64::from(target) * 1.1 { f64::from(target) / effective } else { 1.0 }
        }
        None => 1.0,
    };
    let resize = scale < 0.95;
    let make_gray = o.gray && src.rgb;
    if !resize && !make_gray && (o.dpi.is_none() || o.quality >= 90) {
        return None;
    }
    let mut raster = if make_gray { to_gray(&src) } else { Raster { w: src.w, h: src.h, rgb: src.rgb, data: src.data } };
    if resize {
        let (w, h) = (((f64::from(raster.w) * scale).round() as u32).max(1), ((f64::from(raster.h) * scale).round() as u32).max(1));
        raster = shrink(&raster, w, h);
    }

    // Kandidaten: JPEG immer; bei verlustfreier Vorlage zusaetzlich Flate (Strichzeichnungen!).
    let lossy = (o.dpi.is_some() || was_jpeg || make_gray).then(|| jpeg(&raster, o.quality)).flatten();
    let lossless = (!was_jpeg).then(|| flate(&raster)).flatten();
    let (filter, bytes) = match (lossy, lossless) {
        (Some(j), Some(f)) => if j.len() < f.len() { (&b"DCTDecode"[..], j) } else { (&b"FlateDecode"[..], f) },
        (Some(j), None) => (&b"DCTDecode"[..], j),
        (None, Some(f)) => (&b"FlateDecode"[..], f),
        (None, None) => return None,
    };
    let changed_look = make_gray || resize;
    if !changed_look && bytes.len() as f64 >= stream.content.len() as f64 * 0.92 {
        return None;
    }
    if o.dpi.is_some() && !make_gray && bytes.len() >= stream.content.len() {
        return None;
    }

    let mut dict = stream.dict.clone();
    dict.set("Width", i64::from(raster.w));
    dict.set("Height", i64::from(raster.h));
    dict.set("BitsPerComponent", 8);
    dict.set("Filter", Object::Name(filter.to_vec()));
    dict.remove(b"DecodeParms");
    dict.remove(b"Length");
    if !raster.rgb {
        dict.set("ColorSpace", Object::Name(b"DeviceGray".to_vec()));
    } else if matches!(space, Space::Indexed { .. }) {
        dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
    }
    Some(Stream::new(dict, bytes))
}

/// Verarbeitet alle Bilder; liefert (gesamt, veraendert).
pub(crate) fn process(doc: &mut Document, o: &ImageOptions, shown: &HashMap<ObjectId, f64>) -> (u32, u32) {
    let ids: Vec<ObjectId> = doc
        .objects
        .iter()
        .filter_map(|(id, obj)| match obj {
            Object::Stream(s) if s.dict.get(b"Subtype").and_then(Object::as_name).is_ok_and(|n| n == b"Image") => Some(*id),
            _ => None,
        })
        .collect();
    let mut changed = 0;
    for id in &ids {
        if let Some(new) = transform(doc, *id, o, shown) {
            doc.objects.insert(*id, Object::Stream(new));
            changed += 1;
        }
    }
    (ids.len() as u32, changed)
}

// ---------- Anzeigegroesse der Bilder ----------

type Matrix = [f64; 6];

fn mul(a: Matrix, b: Matrix) -> Matrix {
    [
        a[0] * b[0] + a[1] * b[2],
        a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2],
        a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4],
        a[4] * b[1] + a[5] * b[3] + b[5],
    ]
}

fn matrix_of(doc: &Document, o: Option<&Object>) -> Matrix {
    let Some(Object::Array(a)) = o.map(|o| deref(doc, o)) else { return [1.0, 0.0, 0.0, 1.0, 0.0, 0.0] };
    let v: Vec<f64> = a.iter().filter_map(number).collect();
    if v.len() == 6 { [v[0], v[1], v[2], v[3], v[4], v[5]] } else { [1.0, 0.0, 0.0, 1.0, 0.0, 0.0] }
}

fn scan(doc: &Document, content: &[u8], resources: &Dictionary, ctm: Matrix, depth: u8, out: &mut HashMap<ObjectId, f64>) {
    let Ok(decoded) = Content::decode(content) else { return };
    let xobjects = resources.get(b"XObject").ok().map(|o| deref(doc, o)).and_then(|o| o.as_dict().ok());
    let mut stack: Vec<Matrix> = Vec::new();
    let mut m = ctm;
    for op in decoded.operations {
        match op.operator.as_str() {
            "q" => stack.push(m),
            "Q" => {
                if let Some(p) = stack.pop() {
                    m = p;
                }
            }
            "cm" if op.operands.len() == 6 => {
                let n: Vec<f64> = op.operands.iter().filter_map(number).collect();
                if n.len() == 6 {
                    m = mul([n[0], n[1], n[2], n[3], n[4], n[5]], m);
                }
            }
            "Do" => {
                let Some(name) = op.operands.first().and_then(|o| o.as_name().ok()) else { continue };
                let Some(Ok(Object::Reference(id))) = xobjects.map(|x| x.get(name)) else { continue };
                let Ok(Object::Stream(x)) = doc.get_object(*id) else { continue };
                match x.dict.get(b"Subtype").and_then(Object::as_name) {
                    Ok(b"Image") => {
                        let width = m[0].hypot(m[1]);
                        let entry = out.entry(*id).or_insert(0.0);
                        *entry = entry.max(width);
                    }
                    Ok(b"Form") if depth < 4 => {
                        let inner = mul(matrix_of(doc, x.dict.get(b"Matrix").ok()), m);
                        let res = x.dict.get(b"Resources").ok().map(|o| deref(doc, o)).and_then(|o| o.as_dict().ok()).unwrap_or(resources);
                        if let Ok(bytes) = x.decompressed_content() {
                            scan(doc, &bytes, res, inner, depth + 1, out);
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

/// Breite (in pt), in der jedes Bild auf den Seiten am groessten erscheint.
pub(crate) fn displayed_widths(doc: &Document) -> HashMap<ObjectId, f64> {
    let mut out = HashMap::new();
    for page in doc.get_pages().into_values() {
        let resources = crate::inherited(doc, page, b"Resources")
            .and_then(|o| o.as_dict().ok().cloned())
            .unwrap_or_default();
        let content = doc.get_page_content(page);
        scan(doc, &content, &resources, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0], 0, &mut out);
    }
    out
}

pub(crate) fn note(report: &mut Report, total: u32, changed: u32) {
    report.images = total;
    report.recompressed = changed;
}
