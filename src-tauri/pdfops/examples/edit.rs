//! `cargo run -p folio-pdfops --example edit -- ein.pdf aus.pdf '[{"op":"rotate","pages":[0],"degrees":90}]'`
use folio_pdfops::{apply, Edit};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let edits: Vec<Edit> = serde_json::from_str(&a[3]).expect("Edits (JSON)");
    let out = apply(&std::fs::read(&a[1]).unwrap(), &edits).unwrap();
    std::fs::write(&a[2], out).unwrap();
}
