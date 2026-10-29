//! Unterschrift am Handy: ein winziger Webserver im lokalen Netz.
//!
//! Folio zeigt einen QR-Code mit der Adresse `http://<Rechner-IP>:<Port>/s/<Schluessel>`. Das Handy
//! oeffnet sie im Browser, zeichnet die Unterschrift und schickt sie als PNG zurueck. Kein Konto,
//! keine Cloud: der Weg geht nur ueber das eigene WLAN.
//!
//! Absicherung: der Schluessel ist 128 Bit zufaellig und steht nur im QR-Code; es gibt genau eine
//! Sitzung, die nach einer Unterschrift oder nach zehn Minuten endet; angenommen werden nur
//! Verbindungen aus privaten Adressbereichen (kein offenes Internet); hoechstens ein PNG von
//! 2 MB. Uebertragen wird unverschluesselt (HTTP) - gedacht fuers Heim- und Buero-WLAN.

use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const PAGE: &str = include_str!("sign_page.html");
const MAX_BODY: usize = 2 * 1024 * 1024;
const MAX_HEAD: usize = 16 * 1024;
const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

#[derive(Debug, PartialEq, Eq)]
pub enum Status {
    /// Noch niemand hat die Seite geoeffnet.
    Waiting,
    /// Die Seite ist auf dem Handy offen.
    Connected,
    /// Die Unterschrift ist da (wird nur einmal geliefert, mit `take`).
    Done,
    Expired,
}

struct Inner {
    connected: bool,
    png: Option<Vec<u8>>,
    started: Instant,
}

struct Shared {
    token: String,
    ttl: Duration,
    inner: Mutex<Inner>,
    stop: AtomicBool,
}

pub struct SignServer {
    shared: Arc<Shared>,
    port: u16,
}

/// Die Adresse dieses Rechners im lokalen Netz (ohne etwas zu senden).
pub fn local_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    // Ein Ziel im privaten Bereich: `connect` bei UDP verschickt nichts, waehlt nur die Schnittstelle.
    socket.connect("10.255.255.255:9").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_unspecified() && !ip.is_loopback()).then_some(ip)
}

fn random_token() -> std::io::Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::new(ErrorKind::Other, e.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn private_peer(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local(),
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // fc00::/7 eindeutig lokal
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // fe80::/10 Verbindung lokal
                || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_private() || v4.is_loopback() || v4.is_link_local())
        }
    }
}

impl SignServer {
    /// Startet auf allen Schnittstellen (`0.0.0.0`) an einem freien Port.
    pub fn start(ttl: Duration) -> std::io::Result<Self> {
        Self::start_on(SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0)), ttl)
    }

    pub fn start_on(addr: SocketAddr, ttl: Duration) -> std::io::Result<Self> {
        let listener = TcpListener::bind(addr)?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let shared = Arc::new(Shared {
            token: random_token()?,
            ttl,
            inner: Mutex::new(Inner { connected: false, png: None, started: Instant::now() }),
            stop: AtomicBool::new(false),
        });
        let accept = Arc::clone(&shared);
        thread::spawn(move || {
            while !accept.stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, peer)) => {
                        let shared = Arc::clone(&accept);
                        thread::spawn(move || {
                            let _ = handle(stream, peer, &shared);
                        });
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(40)),
                    Err(_) => thread::sleep(Duration::from_millis(200)),
                }
            }
        });
        Ok(Self { shared, port })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn token(&self) -> &str {
        &self.shared.token
    }

    pub fn status(&self) -> Status {
        let inner = self.shared.inner.lock().unwrap();
        if inner.png.is_some() {
            Status::Done
        } else if inner.started.elapsed() > self.shared.ttl {
            Status::Expired
        } else if inner.connected {
            Status::Connected
        } else {
            Status::Waiting
        }
    }

    /// Die Unterschrift abholen; danach ist die Sitzung leer (der Schluessel gilt nicht mehr).
    pub fn take(&self) -> Option<Vec<u8>> {
        self.shared.inner.lock().unwrap().png.take()
    }

    pub fn stop(&self) {
        self.shared.stop.store(true, Ordering::Relaxed);
    }
}

impl Drop for SignServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\n\
         Referrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

fn text(stream: &mut TcpStream, status: &str, message: &str) -> std::io::Result<()> {
    respond(stream, status, "text/plain; charset=utf-8", message.as_bytes())
}

fn handle(mut stream: TcpStream, peer: SocketAddr, shared: &Shared) -> std::io::Result<()> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(6)))?;
    stream.set_write_timeout(Some(Duration::from_secs(6)))?;
    if !private_peer(peer.ip()) {
        return text(&mut stream, "403 Forbidden", "Nur im lokalen Netz.");
    }

    // Kopf lesen
    let mut buf = Vec::with_capacity(2048);
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if buf.len() > MAX_HEAD {
            return text(&mut stream, "431 Request Header Fields Too Large", "Zu gross.");
        }
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.lines();
    let mut request = lines.next().unwrap_or("").split_whitespace();
    let (method, target) = (request.next().unwrap_or(""), request.next().unwrap_or(""));
    let content_length = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let path = target.split(['?', '#']).next().unwrap_or("");

    let prefix = format!("/s/{}", shared.token);
    let Some(rest) = path.strip_prefix(&prefix) else {
        return text(&mut stream, "404 Not Found", "Nicht gefunden.");
    };
    let rest = rest.trim_end_matches('/');

    {
        let inner = shared.inner.lock().unwrap();
        if inner.started.elapsed() > shared.ttl {
            return text(&mut stream, "410 Gone", "Diese Unterschrifts-Anfrage ist abgelaufen. Bitte am Computer neu starten.");
        }
    }

    match (method, rest) {
        ("GET", "") => {
            shared.inner.lock().unwrap().connected = true;
            respond(&mut stream, "200 OK", "text/html; charset=utf-8", PAGE.as_bytes())
        }
        ("POST", "/png") => {
            if content_length == 0 || content_length > MAX_BODY {
                return text(&mut stream, "413 Payload Too Large", "Ungueltige Groesse.");
            }
            let mut body = buf[head_end..].to_vec();
            while body.len() < content_length {
                let n = stream.read(&mut chunk)?;
                if n == 0 {
                    break;
                }
                body.extend_from_slice(&chunk[..n]);
                if body.len() > MAX_BODY {
                    return text(&mut stream, "413 Payload Too Large", "Zu gross.");
                }
            }
            body.truncate(content_length);
            if body.len() != content_length || !body.starts_with(PNG_MAGIC) || body.len() < 64 {
                return text(&mut stream, "400 Bad Request", "Kein PNG.");
            }
            let mut inner = shared.inner.lock().unwrap();
            if inner.png.is_some() {
                return text(&mut stream, "409 Conflict", "Schon gesendet.");
            }
            inner.png = Some(body);
            drop(inner);
            text(&mut stream, "200 OK", "ok")
        }
        _ => text(&mut stream, "404 Not Found", "Nicht gefunden."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(port: u16, raw: &[u8]) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        s.write_all(raw).unwrap();
        let mut out = Vec::new();
        let _ = s.read_to_end(&mut out);
        String::from_utf8_lossy(&out).into_owned()
    }

    fn png() -> Vec<u8> {
        let mut v = PNG_MAGIC.to_vec();
        v.extend(std::iter::repeat(7u8).take(100));
        v
    }

    fn post(port: u16, token: &str, body: &[u8]) -> String {
        let mut raw = format!(
            "POST /s/{token}/png HTTP/1.1\r\nHost: x\r\nContent-Type: image/png\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .into_bytes();
        raw.extend_from_slice(body);
        request(port, &raw)
    }

    #[test]
    fn serves_the_page_only_for_the_right_token_and_tracks_connection() {
        let server = SignServer::start_on("127.0.0.1:0".parse().unwrap(), Duration::from_secs(60)).unwrap();
        assert_eq!(server.status(), Status::Waiting);
        let wrong = request(server.port(), b"GET /s/0000 HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(wrong.starts_with("HTTP/1.1 404"), "{wrong}");
        assert_eq!(server.status(), Status::Waiting);
        let ok = request(server.port(), format!("GET /s/{} HTTP/1.1\r\nHost: x\r\n\r\n", server.token()).as_bytes());
        assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
        assert!(ok.contains("Bitte hier unterschreiben") && ok.contains("Cache-Control: no-store"));
        assert_eq!(server.status(), Status::Connected);
    }

    #[test]
    fn receives_exactly_one_png_and_hands_it_out_once() {
        let server = SignServer::start_on("127.0.0.1:0".parse().unwrap(), Duration::from_secs(60)).unwrap();
        let sig = png();
        assert!(post(server.port(), server.token(), &sig).starts_with("HTTP/1.1 200"));
        assert_eq!(server.status(), Status::Done);
        assert!(post(server.port(), server.token(), &sig).starts_with("HTTP/1.1 409"), "zweite Unterschrift abgelehnt");
        assert_eq!(server.take().as_deref(), Some(sig.as_slice()));
        assert_eq!(server.take(), None);
    }

    #[test]
    fn rejects_non_png_oversized_and_wrong_token() {
        let server = SignServer::start_on("127.0.0.1:0".parse().unwrap(), Duration::from_secs(60)).unwrap();
        assert!(post(server.port(), server.token(), b"GIF89a nicht png nicht png nicht png nicht png nicht png nicht png nicht png").starts_with("HTTP/1.1 400"));
        assert!(post(server.port(), "falsch", &png()).starts_with("HTTP/1.1 404"));
        let huge = format!("POST /s/{}/png HTTP/1.1\r\nContent-Length: {}\r\n\r\n", server.token(), MAX_BODY + 1);
        assert!(request(server.port(), huge.as_bytes()).starts_with("HTTP/1.1 413"));
        assert_eq!(server.status(), Status::Waiting);
    }

    #[test]
    fn sessions_expire() {
        let server = SignServer::start_on("127.0.0.1:0".parse().unwrap(), Duration::from_millis(150)).unwrap();
        thread::sleep(Duration::from_millis(250));
        assert_eq!(server.status(), Status::Expired);
        let r = request(server.port(), format!("GET /s/{} HTTP/1.1\r\nHost: x\r\n\r\n", server.token()).as_bytes());
        assert!(r.starts_with("HTTP/1.1 410"), "{r}");
        assert!(post(server.port(), server.token(), &png()).starts_with("HTTP/1.1 410"));
    }

    #[test]
    fn tokens_are_random_and_long() {
        let a = SignServer::start_on("127.0.0.1:0".parse().unwrap(), Duration::from_secs(1)).unwrap();
        let b = SignServer::start_on("127.0.0.1:0".parse().unwrap(), Duration::from_secs(1)).unwrap();
        assert_eq!(a.token().len(), 32);
        assert_ne!(a.token(), b.token());
    }

    #[test]
    fn only_private_peers_are_served() {
        assert!(private_peer("192.168.1.20".parse().unwrap()));
        assert!(private_peer("10.0.0.5".parse().unwrap()));
        assert!(private_peer("172.16.4.4".parse().unwrap()));
        assert!(private_peer("169.254.3.3".parse().unwrap()));
        assert!(private_peer("fd12::1".parse().unwrap()));
        assert!(private_peer("fe80::1".parse().unwrap()));
        assert!(!private_peer("8.8.8.8".parse().unwrap()));
        assert!(!private_peer("2001:db8::1".parse().unwrap()));
        assert!(!private_peer("172.32.0.1".parse().unwrap()));
    }

    #[test]
    fn stopping_closes_the_listener() {
        let server = SignServer::start_on("127.0.0.1:0".parse().unwrap(), Duration::from_secs(60)).unwrap();
        let port = server.port();
        server.stop();
        thread::sleep(Duration::from_millis(200));
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
    }
}
