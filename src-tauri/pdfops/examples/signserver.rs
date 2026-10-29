//! Testhilfe: startet den Unterschriften-Server und steuert ihn ueber stdin.
//! `status` -> Zeile mit dem Status, `take` -> Zeile `png:<base64>`, `stop`.
use folio_pdfops::signing::{SignServer, Status};
use std::io::BufRead;
use std::time::Duration;

fn main() {
    let server = SignServer::start_on("127.0.0.1:0".parse().unwrap(), Duration::from_secs(120)).unwrap();
    println!("ready {} {}", server.port(), server.token());
    for line in std::io::stdin().lock().lines() {
        match line.unwrap().trim() {
            "status" => println!("{}", match server.status() { Status::Waiting => "waiting", Status::Connected => "connected", Status::Done => "done", Status::Expired => "expired" }),
            "take" => {
                let bytes = server.take().unwrap_or_default();
                let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
                println!("png:{hex}");
            }
            "stop" => break,
            _ => {}
        }
    }
}
