//! Texterkennung mit Windows.Media.Ocr: eingebaut in Windows 10/11, laeuft offline, braucht aber
//! das Sprachpaket der Sprache, die erkannt werden soll (Einstellungen > Zeit und Sprache).
//!
//! Das Frontend rendert die Seite als PNG und schickt sie als Rohkoerper; zurueck kommen die
//! Woerter samt Rahmen in Bildpunkten.

use serde::Serialize;
use tauri::ipc::Request;

#[derive(Serialize)]
pub struct OcrWord {
    text: String,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}

#[derive(Serialize)]
pub struct OcrLine {
    text: String,
    words: Vec<OcrWord>,
}

#[derive(Serialize)]
pub struct OcrOutput {
    lang: String,
    lines: Vec<OcrLine>,
}

#[cfg(windows)]
fn recognize(png: &[u8], lang: Option<&str>) -> Result<OcrOutput, String> {
    use windows::{
        core::HSTRING,
        Globalization::Language,
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
        Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
    };

    fn fail(what: &str) -> impl Fn(windows::core::Error) -> String + '_ {
        move |e| format!("{what}: {e}")
    }

    // Jeder Arbeitsfaden braucht seine eigene WinRT-Initialisierung. Ein Fehler heisst meist
    // "schon initialisiert" und ist harmlos.
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }

    let wanted = lang
        .filter(|tag| !tag.is_empty())
        .and_then(|tag| Language::CreateLanguage(&HSTRING::from(tag)).ok())
        .filter(|language| OcrEngine::IsLanguageSupported(language).unwrap_or(false))
        .and_then(|language| OcrEngine::TryCreateFromLanguage(&language).ok());
    let engine = match wanted {
        Some(engine) => engine,
        None => OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| {
            "Windows hat keine Texterkennung fuer Ihre Sprachen. Bitte ein Sprachpaket installieren \
             (Einstellungen > Zeit und Sprache > Sprache und Region)."
                .to_string()
        })?,
    };
    let tag = engine
        .RecognizerLanguage()
        .and_then(|l| l.LanguageTag())
        .map(|t| t.to_string())
        .unwrap_or_default();

    let stream = InMemoryRandomAccessStream::new().map_err(fail("Datenstrom"))?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(fail("Datenschreiber"))?;
    writer.WriteBytes(png).map_err(fail("Bild schreiben"))?;
    writer.StoreAsync().and_then(|op| op.get()).map_err(fail("Bild speichern"))?;
    writer.DetachStream().map_err(fail("Datenstrom loesen"))?;
    stream.Seek(0).map_err(fail("Datenstrom zuruecksetzen"))?;

    let decoder = BitmapDecoder::CreateAsync(&stream).and_then(|op| op.get()).map_err(fail("Bild lesen"))?;
    let bitmap = decoder.GetSoftwareBitmapAsync().and_then(|op| op.get()).map_err(fail("Bild umwandeln"))?;
    let limit = OcrEngine::MaxImageDimension().unwrap_or(10000);
    if bitmap.PixelWidth().unwrap_or(0) as u32 > limit || bitmap.PixelHeight().unwrap_or(0) as u32 > limit {
        return Err(format!("Das Bild ist groesser als die erlaubten {limit} Bildpunkte."));
    }
    let result = engine.RecognizeAsync(&bitmap).and_then(|op| op.get()).map_err(fail("Texterkennung"))?;

    let mut lines = Vec::new();
    for line in result.Lines().map_err(fail("Zeilen"))? {
        let mut words = Vec::new();
        for word in line.Words().map_err(fail("Woerter"))? {
            let rect = word.BoundingRect().map_err(fail("Rahmen"))?;
            words.push(OcrWord {
                text: word.Text().map(|t| t.to_string()).unwrap_or_default(),
                x: rect.X,
                y: rect.Y,
                w: rect.Width,
                h: rect.Height,
            });
        }
        lines.push(OcrLine { text: line.Text().map(|t| t.to_string()).unwrap_or_default(), words });
    }
    Ok(OcrOutput { lang: tag, lines })
}

#[cfg(not(windows))]
fn recognize(_png: &[u8], _lang: Option<&str>) -> Result<OcrOutput, String> {
    Err("Die Texterkennung gibt es nur unter Windows.".into())
}

/// Seite als PNG (Rohkoerper), Sprache optional im Kopf `x-lang` (BCP-47, z. B. `de-DE`).
#[tauri::command]
pub async fn ocr_page(request: Request<'_>) -> Result<OcrOutput, String> {
    let lang = request.headers().get("x-lang").and_then(|v| v.to_str().ok()).map(str::to_owned);
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Erwarte Rohdaten".into());
    };
    let png = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || recognize(&png, lang.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}
