//! Tauri-Anbindung fuer `folio-pdfops`: das Frontend schickt die PDF-Bytes als Rohkoerper und
//! die Anweisungen als JSON im Kopf, bekommt die neuen Bytes zurueck. Nichts davon fasst eine
//! Datei an - gesichert wird erst ueber den ueblichen Weg (`save_pdf`).

use crate::file_safety::{decode_hex_path, FileState};
use folio_pdfops::Edit;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::State;

fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .ok_or_else(|| format!("Kopfzeile {name} fehlt"))?
        .to_str()
        .map_err(|e| e.to_string())
}

fn body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(b) => Ok(b.clone()),
        _ => Err("Erwarte Rohdaten".into()),
    }
}

/// Seiten drehen und zuschneiden (`x-edits`: JSON-Liste von `Edit`).
///
/// Laeuft auf einem eigenen Faden: ein grosses PDF umzuschreiben dauert Sekunden und darf die
/// Oberflaeche nicht anhalten.
#[tauri::command]
pub async fn pdf_edit(request: Request<'_>) -> Result<Response, String> {
    let edits: Vec<Edit> = serde_json::from_str(header(&request, "x-edits")?).map_err(|e| e.to_string())?;
    let bytes = body(&request)?;
    let out = tauri::async_runtime::spawn_blocking(move || folio_pdfops::apply(&bytes, &edits))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(Response::new(out))
}

/// Liest eine PDF zum Einfuegen oder Zusammenfuehren, ohne sie als geoeffnet zu fuehren.
#[tauri::command]
pub fn read_pdf_plain(path: String, state: State<'_, FileState>) -> Result<Response, String> {
    Ok(Response::new(state.read_plain(&path)?))
}

/// Speichert Seiten oder eine Kopie unter einem gewaehlten Pfad (`x-path`, hex).
#[tauri::command]
pub fn write_pdf_copy(request: Request<'_>, state: State<'_, FileState>) -> Result<(), String> {
    let path = decode_hex_path(header(&request, "x-path")?)?;
    state.write_copy(&path, &body(&request)?)
}

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

fn temp_root() -> PathBuf {
    std::env::temp_dir().join("Folio-Ablage")
}

/// Raeumt den Ablageordner beim Start auf (Reste eines frueheren Laufs).
pub fn clean_temp() {
    let _ = std::fs::remove_dir_all(temp_root());
}

/// Legt Bytes unter genau diesem Dateinamen ab (`x-name`, hex) und liefert den Pfad. Jede Datei
/// bekommt einen eigenen Unterordner, damit der Name beim Ziehen in den Explorer unveraendert
/// bleibt. Dient dem Herausziehen von Seiten und der Notch-Ablage.
#[tauri::command]
pub fn temp_file(request: Request<'_>) -> Result<String, String> {
    let name = decode_hex_path(header(&request, "x-name")?)?;
    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|e| e == "pdf" || e == "png")
        .ok_or("Nur PDF und PNG")?;
    let dir = temp_root().join(format!("{}-{}", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
    let path = folio_pdfops::files::write_unique(&dir, &name, &ext, &body(&request)?).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(windows)]
fn documents_dir() -> Option<PathBuf> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{FOLDERID_Documents, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
        let raw = SHGetKnownFolderPath(&FOLDERID_Documents, KF_FLAG_DEFAULT, None).ok()?;
        let text = raw.to_string().ok();
        CoTaskMemFree(Some(raw.0 as *const _));
        text.map(PathBuf::from)
    }
}

#[cfg(not(windows))]
fn documents_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Documents"))
}

/// Der Ordner fuer Dokumente, die Folio selbst erzeugt (aus Seiten zusammengestellt,
/// zusammengefuehrt, komprimiert): `Dokumente\Folio`.
fn library_dir() -> Result<PathBuf, String> {
    Ok(documents_dir().ok_or("Der Dokumente-Ordner wurde nicht gefunden")?.join("Folio"))
}

/// Legt ein neues Dokument im Bibliotheksordner an (`x-name`, hex) und liefert den Pfad.
/// Ueberschreibt nie: bei gleichem Namen wird durchgezaehlt.
#[tauri::command]
pub fn library_pdf(request: Request<'_>) -> Result<String, String> {
    let name = decode_hex_path(header(&request, "x-name")?)?;
    let path = folio_pdfops::files::write_unique(&library_dir()?, &name, "pdf", &body(&request)?)
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Verschiebt eine aus Seiten erzeugte Datei aus dem Ablageordner in den Bibliotheksordner. Das
/// passiert, wenn eine herausgezogene Seite im Bibliotheksfenster fallengelassen wird.
#[tauri::command]
pub fn adopt_temp_pdf(path: String) -> Result<String, String> {
    let source = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let root = std::fs::canonicalize(temp_root()).map_err(|_| "Keine Ablagedatei".to_string())?;
    if !source.starts_with(&root) || !source.is_file() {
        return Err("Nur Dateien aus der Folio-Ablage koennen uebernommen werden".into());
    }
    let bytes = std::fs::read(&source).map_err(|e| e.to_string())?;
    let name = source.file_name().and_then(|n| n.to_str()).unwrap_or("Dokument.pdf").to_string();
    let target = folio_pdfops::files::write_unique(&library_dir()?, &name, "pdf", &bytes).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&source);
    Ok(target.to_string_lossy().into_owned())
}
