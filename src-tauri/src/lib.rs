use std::path::PathBuf;
use tauri::ipc::Response;

/// Liest eine PDF-Datei als Rohbytes.
/// Rueckgabe als `Response`, damit Tauri die Bytes binaer durchreicht
/// statt sie fuer die IPC nach Base64 zu kodieren.
#[tauri::command]
fn read_pdf(path: String) -> Result<Response, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("Keine Datei: {path}"));
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("{path}: {e}"))?;
    Ok(Response::new(bytes))
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_pdf, startup_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
