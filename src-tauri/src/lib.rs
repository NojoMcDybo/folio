mod file_safety;

use file_safety::{decode_hex_path, FileState};
use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, State, WebviewWindow};

/// Liest eine PDF-Datei als Rohbytes.
/// Rueckgabe als `Response`, damit Tauri die Bytes binaer durchreicht
/// statt sie fuer die IPC nach Base64 zu kodieren.
#[tauri::command]
fn read_pdf(
    window: WebviewWindow,
    state: State<'_, FileState>,
    path: String,
) -> Result<Response, String> {
    let bytes = state.read_and_register(window.label(), &path)?;
    Ok(Response::new(bytes))
}

/// Schreibt das bearbeitete PDF zurueck.
///
/// Die Bytes kommen als Rohkoerper (ein 27-MB-Dokument als JSON-Zahlenliste
/// waere absurd), der Zielpfad hex-kodiert im Kopf, weil HTTP-Kopfzeilen
/// keine Umlaute vertragen.
///
/// Geschrieben wird erst in eine Nebendatei und danach umbenannt. Bricht der
/// Vorgang mittendrin ab, ist das Original noch unversehrt - sonst koennte
/// ein misslungenes Speichern das Dokument zerstoeren.
#[tauri::command]
fn save_pdf(request: Request<'_>, state: State<'_, FileState>) -> Result<(), String> {
    let header = request
        .headers()
        .get("x-path")
        .ok_or("Kein Pfad uebergeben")?
        .to_str()
        .map_err(|e| e.to_string())?;
    let path = decode_hex_path(header)?;

    let bytes = match request.body() {
        InvokeBody::Raw(b) => b,
        _ => return Err("Erwarte Rohdaten".into()),
    };

    state.save(&path, bytes)
}

/// Verschiebt eine geschlossene, regulaere PDF ausschliesslich in den Papierkorb.
#[tauri::command]
fn recycle_pdf(path: String, state: State<'_, FileState>) -> Result<(), String> {
    state.recycle(&path)
}

/// Erstes Argument, das auf eine existierende PDF zeigt.
fn pdf_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".pdf") && PathBuf::from(a).is_file())
}

/// Beim Doppelklick auf eine PDF haengt Windows den Pfad als Argument an.
#[tauri::command]
fn startup_file() -> Option<String> {
    pdf_from_args(std::env::args())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Zweiter Start soll kein zweites Fenster oeffnen: Windows reicht die
    // Argumente an die laufende Instanz weiter, die holt sich den Fokus
    // und laedt die uebergebene Datei.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(path) = pdf_from_args(argv) {
                let _ = app.emit("folio://open", path);
            }
        }));
    }

    builder
        .manage(FileState::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<FileState>().forget_window(window.label());
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_pdf,
            save_pdf,
            recycle_pdf,
            startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
