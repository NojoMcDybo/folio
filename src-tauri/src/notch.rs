//! Bruecke zur Notch (http://127.0.0.1:47800).
//!
//! Laeuft bewusst ueber Rust statt ueber fetch() im WebView: neuere WebView2-Versionen
//! sperren Anfragen von der App-Seite an localhost ("Local Network Access").
//! Feuer und vergessen — laeuft keine Notch, passiert einfach nichts.

use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

#[tauri::command]
pub fn notch_send(method: String, path: String, body: Option<String>) {
    // Nur die beiden Pfade, die Folio braucht, und nur POST/DELETE
    let ok_path = path.starts_with("/activity") || path == "/shelf";
    let ok_method = method == "POST" || method == "DELETE";
    if !ok_path || !ok_method || path.contains(['\r', '\n', ' ']) {
        return;
    }
    std::thread::spawn(move || {
        let addr: SocketAddr = ([127, 0, 0, 1], 47800).into();
        let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else { return };
        let _ = s.set_write_timeout(Some(Duration::from_secs(1)));
        let body = body.unwrap_or_default();
        let req = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:47800\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = s.write_all(req.as_bytes());
        let _ = s.flush();
        // Antwort abwarten, damit der Server die Anfrage sicher fertig liest
        let _ = s.set_read_timeout(Some(Duration::from_secs(1)));
        let mut buf = [0u8; 64];
        let _ = std::io::Read::read(&mut s, &mut buf);
    });
}
