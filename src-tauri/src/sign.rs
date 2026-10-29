//! Tauri-Anbindung des Unterschriften-Servers aus `folio-pdfops::signing`.

use folio_pdfops::signing::{local_ip, SignServer, Status};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Response;
use tauri::State;

#[derive(Default)]
pub struct SignState(Mutex<Option<SignServer>>);

#[derive(Serialize)]
pub struct SignInfo {
    url: String,
    ip: String,
    port: u16,
}

/// Startet eine neue Sitzung (eine alte endet damit). Liefert die Adresse fuer den QR-Code.
#[tauri::command]
pub fn sign_start(state: State<'_, SignState>) -> Result<SignInfo, String> {
    let ip = local_ip().ok_or("Kein Netzwerk gefunden. Der Computer muss mit dem WLAN oder LAN verbunden sein.")?;
    let mut slot = state.0.lock().map_err(|_| "Interner Zustand nicht verfuegbar".to_string())?;
    if let Some(old) = slot.take() {
        old.stop();
    }
    let server = SignServer::start(Duration::from_secs(600))
        .map_err(|e| format!("Der lokale Server konnte nicht starten: {e}"))?;
    let info = SignInfo {
        url: format!("http://{ip}:{}/s/{}", server.port(), server.token()),
        ip: ip.to_string(),
        port: server.port(),
    };
    *slot = Some(server);
    Ok(info)
}

/// `none`, `waiting`, `connected`, `done` oder `expired`.
#[tauri::command]
pub fn sign_status(state: State<'_, SignState>) -> &'static str {
    match state.0.lock().ok().and_then(|s| s.as_ref().map(SignServer::status)) {
        None => "none",
        Some(Status::Waiting) => "waiting",
        Some(Status::Connected) => "connected",
        Some(Status::Done) => "done",
        Some(Status::Expired) => "expired",
    }
}

/// Holt die Unterschrift (PNG) ab; danach endet die Sitzung.
#[tauri::command]
pub fn sign_take(state: State<'_, SignState>) -> Result<Response, String> {
    let mut slot = state.0.lock().map_err(|_| "Interner Zustand nicht verfuegbar".to_string())?;
    let png = slot.as_ref().and_then(SignServer::take).ok_or("Noch keine Unterschrift")?;
    if let Some(server) = slot.take() {
        server.stop();
    }
    Ok(Response::new(png))
}

#[tauri::command]
pub fn sign_stop(state: State<'_, SignState>) {
    if let Ok(mut slot) = state.0.lock() {
        if let Some(server) = slot.take() {
            server.stop();
        }
    }
}
