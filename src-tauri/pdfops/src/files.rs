//! Neue Dateien anlegen, ohne je etwas zu ueberschreiben: Namen bereinigen, freien Namen finden,
//! atomar schreiben. Bewusst ohne Tauri, damit es sich hier testen laesst.

use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use crate::{Error, Result};

const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1",
    "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Dateiname ohne Endung, der unter Windows sicher angelegt werden kann.
pub fn sanitize_name(raw: &str) -> String {
    let mut s: String = raw
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
        .collect();
    s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    s = s.trim_matches(|c| c == '.' || c == ' ').to_string();
    if s.chars().count() > 120 {
        s = s.chars().take(120).collect::<String>().trim_end().to_string();
    }
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    if s.is_empty() || RESERVED.contains(&stem.as_str()) {
        return "Dokument".to_string();
    }
    s
}

/// `name.pdf`, sonst `name (2).pdf`, `name (3).pdf` ...
pub fn candidate(dir: &Path, stem: &str, ext: &str, n: u32) -> PathBuf {
    if n <= 1 {
        dir.join(format!("{stem}.{ext}"))
    } else {
        dir.join(format!("{stem} ({n}).{ext}"))
    }
}

/// Legt eine neue Datei an. Schlaegt fehl, wenn es sie schon gibt; ein abgebrochener Schreibvorgang
/// hinterlaesst keine halbe Datei.
pub fn create_new_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if written.is_err() {
        let _ = std::fs::remove_file(path);
    }
    written
}

/// Schreibt `bytes` unter einem freien Namen in `dir` und liefert den Pfad.
pub fn write_unique(dir: &Path, name_hint: &str, ext: &str, bytes: &[u8]) -> Result<PathBuf> {
    std::fs::create_dir_all(dir).map_err(|e| Error::Invalid(format!("Ordner konnte nicht angelegt werden: {e}")))?;
    let stem = sanitize_name(name_hint.strip_suffix(&format!(".{ext}")).unwrap_or(name_hint));
    for n in 1..=999 {
        let path = candidate(dir, &stem, ext, n);
        match create_new_file(&path, bytes) {
            Ok(()) => return Ok(path),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(Error::Invalid(format!("{}: {e}", path.display()))),
        }
    }
    Err(Error::Invalid("Kein freier Dateiname gefunden.".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("folio-pdfops-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sanitizes_reserved_characters_and_names() {
        assert_eq!(sanitize_name("Bericht: Q1/Q2?"), "Bericht Q1 Q2");
        assert_eq!(sanitize_name("  ..Name.. "), "Name");
        assert_eq!(sanitize_name("con"), "Dokument");
        assert_eq!(sanitize_name("NUL.txt"), "Dokument");
        assert_eq!(sanitize_name("***"), "Dokument");
        assert_eq!(sanitize_name("Übung ä ö ü"), "Übung ä ö ü");
        assert_eq!(sanitize_name(&"a".repeat(300)).chars().count(), 120);
    }

    #[test]
    fn never_overwrites_and_counts_up() {
        let dir = scratch("unique");
        let a = write_unique(&dir, "Skript.pdf", "pdf", b"eins").unwrap();
        let b = write_unique(&dir, "Skript", "pdf", b"zwei").unwrap();
        let c = write_unique(&dir, "Skript.pdf", "pdf", b"drei").unwrap();
        assert_eq!(a.file_name().unwrap(), "Skript.pdf");
        assert_eq!(b.file_name().unwrap(), "Skript (2).pdf");
        assert_eq!(c.file_name().unwrap(), "Skript (3).pdf");
        assert_eq!(std::fs::read(&a).unwrap(), b"eins");
        assert_eq!(std::fs::read(&b).unwrap(), b"zwei");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn create_new_refuses_existing_files() {
        let dir = scratch("exists");
        let path = dir.join("x.pdf");
        create_new_file(&path, b"alt").unwrap();
        let err = create_new_file(&path, b"neu").unwrap_err();
        assert_eq!(err.kind(), ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(&path).unwrap(), b"alt");
        let _ = std::fs::remove_dir_all(dir);
    }
}
