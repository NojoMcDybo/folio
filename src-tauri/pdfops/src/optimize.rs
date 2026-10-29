//! Verkleinern, Schwarzweiss, Einbrennen - einzeln oder zusammen, in einem Durchgang.

use crate::{colors, flatten, images, Error, Result};
use lopdf::{Document, SaveOptions};
use serde::{Deserialize, Serialize};

fn default_quality() -> u8 { 75 }

/// Die Voreinstellungen heissen wie im Programm: `screen`, `mail`, `print`.
pub fn preset(name: &str) -> Option<(f32, u8)> {
    match name {
        "screen" => Some((100.0, 55)),
        "mail" => Some((150.0, 70)),
        "print" => Some((220.0, 82)),
        _ => None,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct OptimizeOptions {
    /// Anmerkungen und Formularfelder in die Seiten einbrennen.
    pub flatten: bool,
    /// Alles in Graustufen umrechnen.
    pub gray: bool,
    /// Bilder auf diese Aufloesung herunterrechnen (nie hoeher als vorhanden).
    pub dpi: Option<f32>,
    /// JPEG-Qualitaet 10..=100.
    pub quality: u8,
}

impl Default for OptimizeOptions {
    fn default() -> Self {
        Self { flatten: false, gray: false, dpi: None, quality: default_quality() }
    }
}

#[derive(Debug, Default, Serialize)]
pub struct Report {
    pub before: usize,
    pub after: usize,
    pub images: u32,
    pub recompressed: u32,
    pub flattened: u32,
    /// Farbkonstrukte, die sich nicht umrechnen liessen (Muster, Verlaeufe, Sonderfarben).
    pub unconverted: u32,
    pub unconverted_pages: u32,
    pub warnings: Vec<String>,
}

/// Fuehrt die gewuenschten Schritte aus. Ist das Ergebnis nicht kleiner und wurde nichts anderes
/// verlangt (Schwarzweiss, Einbrennen), kommt das Original unveraendert zurueck - Verkleinern
/// darf eine Datei nie vergroessern.
pub fn optimize(bytes: &[u8], o: &OptimizeOptions) -> Result<(Vec<u8>, Report)> {
    let mut doc = Document::load_mem(bytes)?;
    if doc.is_encrypted() {
        return Err(Error::Invalid("Verschluesselte PDFs koennen hier nicht bearbeitet werden.".into()));
    }
    let mut report = Report { before: bytes.len(), ..Report::default() };

    if o.flatten {
        flatten::flatten(&mut doc, &mut report);
    }
    if o.gray {
        colors::grayscale(&mut doc, &mut report);
    }
    if o.gray || o.dpi.is_some() {
        let shown = images::displayed_widths(&doc);
        let (total, changed) = images::process(&mut doc, &images::ImageOptions { dpi: o.dpi, quality: o.quality, gray: o.gray }, &shown);
        images::note(&mut report, total, changed);
    }
    doc.prune_objects();
    doc.compress();

    let mut out = Vec::with_capacity(bytes.len());
    doc.save_with_options(&mut out, SaveOptions::builder().use_object_streams(true).use_xref_streams(true).build())?;

    let only_shrink = !o.gray && !o.flatten;
    if only_shrink && out.len() >= bytes.len() {
        report.after = bytes.len();
        report.warnings.push("Die Datei ließ sich nicht weiter verkleinern.".into());
        return Ok((bytes.to_vec(), report));
    }
    report.after = out.len();
    if o.gray && (report.unconverted > 0 || report.unconverted_pages > 0) {
        report.warnings.push(format!(
            "{} Farbkonstrukte (Muster, Verläufe, Sonderfarben) blieben farbig.",
            report.unconverted.max(report.unconverted_pages)
        ));
    }
    Ok((out, report))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{codecs::jpeg::JpegEncoder, ExtendedColorType};
    use lopdf::{dictionary, Object, Stream};

    /// Eine Seite (200 x 300 pt) mit einem JPEG von `px` x `px`, 100 pt breit dargestellt.
    fn with_image(px: u32) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages = doc.new_object_id();
        let mut rgb = Vec::with_capacity((px * px * 3) as usize);
        for y in 0..px {
            for x in 0..px {
                rgb.extend_from_slice(&[(x * 255 / px) as u8, (y * 255 / px) as u8, ((x * y) % 251) as u8]);
            }
        }
        let mut jpg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpg, 95).encode(&rgb, px, px, ExtendedColorType::Rgb8).unwrap();
        let img = doc.add_object(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => i64::from(px), "Height" => i64::from(px),
                "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8, "Filter" => "DCTDecode" },
            jpg,
        ));
        let content = doc.add_object(Stream::new(dictionary! {}, b"q 100 0 0 100 20 150 cm /Im1 Do Q\n1 0 0 rg 10 10 50 50 re f".to_vec()));
        let page = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages, "Contents" => content,
            "Resources" => dictionary! { "XObject" => dictionary! { "Im1" => img } },
        });
        doc.objects.insert(pages, Object::Dictionary(dictionary! {
            "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1,
            "MediaBox" => vec![0.into(), 0.into(), 200.into(), 300.into()],
        }));
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
        doc.trailer.set("Root", catalog);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    fn image_of(bytes: &[u8]) -> (i64, i64, Vec<u8>) {
        let doc = Document::load_mem(bytes).unwrap();
        for o in doc.objects.values() {
            if let Object::Stream(s) = o {
                if s.dict.get(b"Subtype").and_then(Object::as_name).is_ok_and(|n| n == b"Image") {
                    let cs = s.dict.get(b"ColorSpace").and_then(Object::as_name).map(<[u8]>::to_vec).unwrap_or_default();
                    return (s.dict.get(b"Width").unwrap().as_i64().unwrap(), s.dict.get(b"Height").unwrap().as_i64().unwrap(), cs);
                }
            }
        }
        panic!("kein Bild");
    }

    #[test]
    fn downsamples_to_the_target_resolution_measured_from_the_page() {
        // 1200 px auf 100 pt = 864 dpi; Ziel 150 dpi -> 100 pt = 1.389 in -> 208 px
        let pdf = with_image(1200);
        let (out, report) = optimize(&pdf, &OptimizeOptions { dpi: Some(150.0), quality: 70, ..Default::default() }).unwrap();
        let (w, h, _) = image_of(&out);
        assert!((205..=211).contains(&w) && w == h, "{w}x{h}");
        assert_eq!((report.images, report.recompressed), (1, 1));
        assert!(out.len() < pdf.len() / 4, "{} -> {}", pdf.len(), out.len());
    }

    #[test]
    fn never_upsamples_and_never_returns_something_bigger() {
        let pdf = with_image(100); // 72 dpi: schon unter dem Ziel
        let (out, report) = optimize(&pdf, &OptimizeOptions { dpi: Some(150.0), quality: 95, ..Default::default() }).unwrap();
        assert_eq!(image_of(&out).0, 100);
        assert!(out.len() <= pdf.len());
        assert!(report.after <= report.before);
    }

    #[test]
    fn grayscale_converts_image_and_vector_colors() {
        let pdf = with_image(300);
        let (out, report) = optimize(&pdf, &OptimizeOptions { gray: true, ..Default::default() }).unwrap();
        assert_eq!(image_of(&out).2, b"DeviceGray");
        assert_eq!(report.unconverted_pages, 0);
        let doc = Document::load_mem(&out).unwrap();
        let page = *doc.get_pages().values().next().unwrap();
        let content = String::from_utf8_lossy(&doc.get_page_content(page)).into_owned();
        assert!(content.contains(" g") && !content.contains("rg"), "{content}");
        assert!(content.contains("0.299"), "{content}"); // 1 0 0 rg -> 0.299 g
    }

    #[test]
    fn content_rewrite_handles_cmyk_named_spaces_and_state() {
        let doc = Document::with_version("1.5");
        let res = dictionary! {
            "ColorSpace" => dictionary! { "Cs1" => vec![Object::Name(b"ICCBased".to_vec())] },
        };
        let src = b"0 1 1 0 k /DeviceRGB cs 0 0 1 sc q /DeviceCMYK CS 0 0 0 1 SC Q 0 0 1 sc 0.5 g";
        let (out, skipped) = colors_rewrite(&doc, src, &res);
        let text = String::from_utf8_lossy(&out).into_owned();
        assert_eq!(skipped, 0);
        assert!(!text.contains(" k") && !text.contains("/DeviceRGB") && !text.contains("/DeviceCMYK"), "{text}");
        assert!(text.contains("0.114 sc"), "{text}"); // blau -> 0.114
        assert!(text.contains("0.5 g"));
    }

    fn colors_rewrite(doc: &Document, src: &[u8], res: &lopdf::Dictionary) -> (Vec<u8>, u32) {
        crate::colors::rewrite_for_test(doc, src, res)
    }

    #[test]
    fn flatten_burns_the_appearance_in_and_removes_the_annotation() {
        let mut doc = Document::with_version("1.5");
        let pages = doc.new_object_id();
        let ap = doc.add_object(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), 10.into(), 10.into()] },
            b"1 0 0 rg 0 0 10 10 re f".to_vec(),
        ));
        let stamp = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Stamp", "Rect" => vec![50.into(), 60.into(), 90.into(), 100.into()],
            "AP" => dictionary! { "N" => ap },
        });
        let link = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Link", "Rect" => vec![0.into(), 0.into(), 5.into(), 5.into()],
        });
        let content = doc.add_object(Stream::new(dictionary! {}, b"0 g 0 0 5 5 re f".to_vec()));
        let page = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages, "Contents" => content, "Annots" => vec![stamp.into(), link.into()],
        });
        doc.objects.insert(pages, Object::Dictionary(dictionary! {
            "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1,
            "MediaBox" => vec![0.into(), 0.into(), 200.into(), 300.into()],
        }));
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
        doc.trailer.set("Root", catalog);
        let mut pdf = Vec::new();
        doc.save_to(&mut pdf).unwrap();

        let (out, report) = optimize(&pdf, &OptimizeOptions { flatten: true, ..Default::default() }).unwrap();
        assert_eq!(report.flattened, 1);
        let doc = Document::load_mem(&out).unwrap();
        let page_id = *doc.get_pages().values().next().unwrap();
        let annots = doc.get_dictionary(page_id).unwrap().get(b"Annots").unwrap().as_array().unwrap().len();
        assert_eq!(annots, 1, "nur der Link bleibt");
        let text = String::from_utf8_lossy(&doc.get_page_content(page_id)).into_owned();
        // 10x10 -> 40x40 bei (50,60): Skalierung 4, Versatz 50/60
        assert!(text.contains("4.00000 0.00000 0.00000 4.00000 50.0000 60.0000 cm /FoFlat1 Do"), "{text}");
    }

    #[test]
    fn presets_and_encrypted_input() {
        assert_eq!(preset("mail"), Some((150.0, 70)));
        assert_eq!(preset("unbekannt"), None);
        assert!(optimize(b"kein pdf", &OptimizeOptions::default()).is_err());
    }
}
