//! `cargo run -p folio-pdfops --example optimize -- ein.pdf aus.pdf '{"dpi":150,"quality":70,"gray":false}'`
use folio_pdfops::{optimize, OptimizeOptions};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let opts: OptimizeOptions = serde_json::from_str(&a[3]).expect("Optionen (JSON)");
    let (out, report) = optimize(&std::fs::read(&a[1]).unwrap(), &opts).unwrap();
    std::fs::write(&a[2], out).unwrap();
    println!("{}", serde_json::to_string(&report).unwrap());
}
