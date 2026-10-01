//! Bruecke zur Notch (http://127.0.0.1:47800).
//!
//! Laeuft bewusst ueber Rust statt ueber fetch() im WebView: neuere WebView2-Versionen
//! sperren Anfragen von der App-Seite an localhost ("Local Network Access").
//! Laeuft keine Notch, passiert einfach nichts.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

fn addr() -> SocketAddr {
    ([127, 0, 0, 1], 47800).into()
}

/// Eine Anfrage schicken und die Antwort (nur den Rumpf) zurueckgeben.
fn request(method: &str, path: &str, body: &str) -> Option<String> {
    let mut s = TcpStream::connect_timeout(&addr(), Duration::from_millis(300)).ok()?;
    let _ = s.set_write_timeout(Some(Duration::from_secs(1)));
    let _ = s.set_read_timeout(Some(Duration::from_secs(1)));
    let req = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:47800\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    s.write_all(req.as_bytes()).ok()?;
    let _ = s.flush();
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    text.split_once("\r\n\r\n").map(|(_, b)| b.to_string())
}

type Job = (String, String, String);

/// Alle Sendungen laufen nacheinander durch einen Faden — so kommt bei schnellem
/// Blaettern nie eine alte Seitenzahl nach einer neueren an.
fn sender() -> &'static Mutex<Sender<Job>> {
    static TX: OnceLock<Mutex<Sender<Job>>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = channel::<Job>();
        std::thread::spawn(move || {
            while let Ok(mut job) = rx.recv() {
                // Aufgestaute Meldungen zusammenfassen: gleicher Pfad -> nur die neueste zaehlt
                while let Ok(next) = rx.try_recv() {
                    if next.0 != job.0 || next.1 != job.1 {
                        let _ = request(&job.0, &job.1, &job.2);
                    }
                    job = next;
                }
                let _ = request(&job.0, &job.1, &job.2);
            }
        });
        Mutex::new(tx)
    })
}

#[tauri::command]
pub fn notch_send(method: String, path: String, body: Option<String>) {
    // Nur die Pfade, die Folio braucht, und nur POST/DELETE
    let ok_path = path.starts_with("/activity") || path == "/shelf";
    let ok_method = method == "POST" || method == "DELETE";
    if !ok_path || !ok_method || path.contains(['\r', '\n', ' ']) {
        return;
    }
    if let Ok(tx) = sender().lock() {
        let _ = tx.send((method, path, body.unwrap_or_default()));
    }
}

/// Ereignisse aus der Notch abholen (Eingaben im Suchfeld, Klicks). Liefert das JSON-Array
/// von GET /events?after=N oder nichts, wenn keine Notch laeuft.
#[tauri::command]
pub async fn notch_events(after: u64) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || request("GET", &format!("/events?after={after}"), ""))
        .await
        .ok()
        .flatten()
}
