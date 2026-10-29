//! `cargo run -p folio-pdfops --example embed -- ein.pdf aus.pdf seiten.json`
use folio_pdfops::text::{embed_text, PageText};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let pages: Vec<PageText> = serde_json::from_slice(&std::fs::read(&a[3]).unwrap()).expect("Seiten (JSON)");
    std::fs::write(&a[2], embed_text(&std::fs::read(&a[1]).unwrap(), &pages).unwrap()).unwrap();
}
