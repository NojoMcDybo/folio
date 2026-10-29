// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `folio --compress|--gray|--flatten|--optimize <PDF> ...` arbeitet ohne Fenster (die Notch ruft
    // es so auf). Alles andere startet die Oberflaeche.
    if let Some(code) = folio_pdfops::cli::run(std::env::args().skip(1).collect()) {
        std::process::exit(code);
    }
    folio_lib::run()
}
