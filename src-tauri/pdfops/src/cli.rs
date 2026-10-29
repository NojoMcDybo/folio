//! Kommandozeile: `folio.exe --compress|--gray|--flatten|--optimize <PDF> [Optionen]`.
//!
//! Gedacht fuer andere Programme (die Notch ruft es fuer "Komprimieren" und "Schwarzweiss" auf),
//! ohne dass ein Fenster aufgeht. Das Ergebnis wird nie ueber eine vorhandene Datei geschrieben.
//!
//! ```text
//! --compress  <PDF>   Bilder verkleinern (Voreinstellung --preset mail)
//! --gray      <PDF>   in Graustufen umrechnen
//! --flatten   <PDF>   Anmerkungen und Formularfelder einbrennen
//! --optimize  <PDF>   frei kombinieren: --preset screen|mail|print, --dpi N, --quality N, --gray, --flatten
//! --out <Datei>       Ziel (sonst neben dem Original: "Name (komprimiert).pdf")
//! --report <Datei>    Bericht als JSON (der Bericht steht auch auf stdout)
//! ```
//! Rueckgabe: 0 = fertig, 1 = Fehler beim Verarbeiten, 2 = falsche Aufrufe, 3 = Ziel existiert.

use crate::files::{create_new_file, write_unique};
use crate::{optimize, preset, OptimizeOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const MODES: [&str; 4] = ["--compress", "--gray", "--flatten", "--optimize"];

/// `None`, wenn die Argumente nicht fuer die Kommandozeile gedacht sind (dann startet die Oberflaeche).
pub fn run(args: Vec<String>) -> Option<i32> {
    let mode = args.first()?.as_str();
    if !MODES.contains(&mode) {
        return None;
    }
    Some(match execute(&args) {
        Ok(()) => 0,
        Err((code, message)) => {
            // Ohne Konsole (Fenster-Programm unter Windows) gibt es kein stderr: Fehler hier nie fatal.
            let _ = writeln!(std::io::stderr(), "{message}");
            code
        }
    })
}

type Failure = (i32, String);

fn usage(message: &str) -> Failure {
    (2, format!("{message}\nAufruf: folio --compress|--gray|--flatten|--optimize <PDF> [--out <Datei>] [--preset screen|mail|print] [--dpi N] [--quality N] [--gray] [--flatten] [--report <Datei>]"))
}

fn execute(args: &[String]) -> Result<(), Failure> {
    let mode = args[0].as_str();
    let mut input: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;
    let mut report_path: Option<PathBuf> = None;
    let mut opts = OptimizeOptions::default();
    let mut preset_name: Option<String> = None;
    let mut it = args.iter().skip(1);
    while let Some(a) = it.next() {
        let mut value = |name: &str| it.next().cloned().ok_or_else(|| usage(&format!("{name} braucht einen Wert")));
        match a.as_str() {
            "--out" => out = Some(PathBuf::from(value("--out")?)),
            "--report" => report_path = Some(PathBuf::from(value("--report")?)),
            "--preset" => preset_name = Some(value("--preset")?),
            "--dpi" => opts.dpi = Some(value("--dpi")?.parse().map_err(|_| usage("--dpi erwartet eine Zahl"))?),
            "--quality" => opts.quality = value("--quality")?.parse().map_err(|_| usage("--quality erwartet eine Zahl"))?,
            "--gray" => opts.gray = true,
            "--flatten" => opts.flatten = true,
            other if !other.starts_with("--") && input.is_none() => input = Some(PathBuf::from(other)),
            other => return Err(usage(&format!("Unbekannte Angabe: {other}"))),
        }
    }
    match mode {
        "--compress" => { if opts.dpi.is_none() && preset_name.is_none() { preset_name = Some("mail".into()); } }
        "--gray" => opts.gray = true,
        "--flatten" => opts.flatten = true,
        _ => {}
    }
    if let Some(name) = &preset_name {
        let (dpi, quality) = preset(name).ok_or_else(|| usage(&format!("Unbekannte Voreinstellung: {name}")))?;
        opts.dpi = opts.dpi.or(Some(dpi));
        if !args.iter().any(|a| a == "--quality") { opts.quality = quality; }
    }
    if !(10..=100).contains(&opts.quality) {
        return Err(usage("--quality liegt zwischen 10 und 100"));
    }
    let input = input.ok_or_else(|| usage("Es fehlt die PDF-Datei"))?;
    if !input.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) || !input.is_file() {
        return Err(usage(&format!("Keine PDF-Datei: {}", input.display())));
    }
    if opts.dpi.is_none() && !opts.gray && !opts.flatten {
        return Err(usage("Es ist nichts zu tun: --preset/--dpi, --gray oder --flatten angeben"));
    }

    let bytes = std::fs::read(&input).map_err(|e| (1, format!("{}: {e}", input.display())))?;
    let (result, report) = optimize(&bytes, &opts).map_err(|e| (1, e.to_string()))?;

    let written = match out {
        Some(target) => {
            create_new_file(&target, &result).map_err(|e| {
                (if e.kind() == std::io::ErrorKind::AlreadyExists { 3 } else { 1 }, format!("{}: {e}", target.display()))
            })?;
            target
        }
        None => {
            let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("Dokument");
            let label = match (opts.dpi.is_some(), opts.gray, opts.flatten) {
                (true, false, false) => "komprimiert",
                (false, true, false) => "schwarzweiß",
                (false, false, true) => "eingebrannt",
                _ => "optimiert",
            };
            let dir = input.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
            write_unique(dir, &format!("{stem} ({label})"), "pdf", &result).map_err(|e| (1, e.to_string()))?
        }
    };
    let json = serde_json::json!({
        "output": written.to_string_lossy(),
        "before": report.before, "after": report.after,
        "images": report.images, "recompressed": report.recompressed, "flattened": report.flattened,
        "warnings": report.warnings,
    })
    .to_string();
    if let Some(path) = report_path {
        std::fs::write(&path, &json).map_err(|e| (1, format!("{}: {e}", path.display())))?;
    }
    let _ = writeln!(std::io::stdout(), "{json}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("folio-cli-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn ignores_arguments_that_are_not_commands() {
        assert_eq!(run(args(&["C:\\x\\a.pdf"])), None);
        assert_eq!(run(vec![]), None);
    }

    #[test]
    fn compress_writes_next_to_the_original_and_never_overwrites() {
        let d = dir("compress");
        let pdf = d.join("Bericht.pdf");
        std::fs::write(&pdf, crate::testutil::sample(3)).unwrap();
        let p = pdf.to_str().unwrap();
        assert_eq!(run(args(&["--gray", p])), Some(0));
        assert!(d.join("Bericht (schwarzweiß).pdf").is_file());
        assert_eq!(run(args(&["--gray", p])), Some(0));
        assert!(d.join("Bericht (schwarzweiß) (2).pdf").is_file());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn explicit_output_is_refused_when_it_exists_and_reports_are_written() {
        let d = dir("out");
        let pdf = d.join("a.pdf");
        std::fs::write(&pdf, crate::testutil::sample(2)).unwrap();
        let out = d.join("neu.pdf");
        let report = d.join("bericht.json");
        let (p, o, r) = (pdf.to_str().unwrap(), out.to_str().unwrap(), report.to_str().unwrap());
        assert_eq!(run(args(&["--compress", p, "--out", o, "--report", r])), Some(0));
        assert!(out.is_file());
        let json: serde_json::Value = serde_json::from_slice(&std::fs::read(&report).unwrap()).unwrap();
        assert_eq!(json["output"], o);
        assert_eq!(run(args(&["--compress", p, "--out", o])), Some(3));
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn usage_errors() {
        let d = dir("usage");
        let pdf = d.join("a.pdf");
        std::fs::write(&pdf, crate::testutil::sample(1)).unwrap();
        let p = pdf.to_str().unwrap();
        assert_eq!(run(args(&["--compress"])), Some(2));
        assert_eq!(run(args(&["--compress", p, "--preset", "riesig"])), Some(2));
        assert_eq!(run(args(&["--optimize", p])), Some(2)); // nichts zu tun
        assert_eq!(run(args(&["--gray", d.join("fehlt.pdf").to_str().unwrap()])), Some(2));
        assert_eq!(run(args(&["--gray", p, "--quality", "5"])), Some(2));
        let _ = std::fs::remove_dir_all(d);
    }
}
