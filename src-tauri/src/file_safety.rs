use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

static NEXT_SIDECAR_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub(crate) struct FileState {
    inner: Mutex<FileRegistry>,
}

#[derive(Default)]
struct FileRegistry {
    open_by_window: HashMap<String, PathBuf>,
}

impl FileState {
    pub(crate) fn read_and_register(
        &self,
        window_label: &str,
        path: &str,
    ) -> Result<Vec<u8>, String> {
        let mut registry = self
            .inner
            .lock()
            .map_err(|_| "Interner Dateizustand ist nicht verfuegbar".to_string())?;
        let canonical = validate_pdf_path(path, false)?;
        let bytes = std::fs::read(&canonical)
            .map_err(|error| format!("{}: {error}", canonical.display()))?;
        registry
            .open_by_window
            .insert(window_label.to_owned(), canonical);
        Ok(bytes)
    }

    pub(crate) fn save(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        let _registry = self
            .inner
            .lock()
            .map_err(|_| "Interner Dateizustand ist nicht verfuegbar".to_string())?;
        let canonical = validate_pdf_path(path, true)?;
        save_atomically(&canonical, bytes)
    }

    pub(crate) fn recycle(&self, path: &str) -> Result<(), String> {
        let registry = self
            .inner
            .lock()
            .map_err(|_| "Interner Dateizustand ist nicht verfuegbar".to_string())?;
        let canonical = validate_pdf_path(path, true)?;

        if registry
            .open_by_window
            .values()
            .any(|open| paths_equal(open, &canonical))
        {
            return Err(
                "Die PDF ist noch in einem Folio-Fenster geoeffnet. Bitte zuerst schliessen."
                    .into(),
            );
        }

        recycle_native(canonical)
    }

    pub(crate) fn forget_window(&self, window_label: &str) {
        if let Ok(mut registry) = self.inner.lock() {
            registry.open_by_window.remove(window_label);
        }
    }
}

pub(crate) fn decode_hex_path(value: &str) -> Result<String, String> {
    if value.len() % 2 != 0 {
        return Err("ungueltige Hex-Laenge".into());
    }

    fn nibble(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }

    let mut decoded = Vec::with_capacity(value.len() / 2);
    for pair in value.as_bytes().chunks_exact(2) {
        let high = nibble(pair[0]).ok_or("ungueltige Hex-Zeichen")?;
        let low = nibble(pair[1]).ok_or("ungueltige Hex-Zeichen")?;
        decoded.push((high << 4) | low);
    }
    String::from_utf8(decoded).map_err(|_| "Pfad ist nicht gueltiges UTF-8".into())
}

fn validate_pdf_path(raw: &str, reject_reparse: bool) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return Err("Leerer Dateipfad".into());
    }
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err("Der PDF-Pfad muss absolut sein".into());
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err("Relative Pfadsegmente sind nicht erlaubt".into());
    }
    reject_special_windows_prefix(path)?;

    let metadata =
        std::fs::symlink_metadata(path).map_err(|error| format!("PDF nicht gefunden: {error}"))?;
    if reject_reparse && is_reparse_point(&metadata) {
        return Err("Verknuepfte oder spezielle Dateien sind nicht erlaubt".into());
    }
    if !metadata.file_type().is_file() {
        return Err("Der Pfad bezeichnet keine regulaere Datei".into());
    }

    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("PDF-Pfad konnte nicht aufgeloest werden: {error}"))?;
    let extension_is_pdf = canonical
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));
    if !extension_is_pdf {
        return Err("Nur PDF-Dateien sind erlaubt".into());
    }

    let canonical_metadata = std::fs::symlink_metadata(&canonical)
        .map_err(|error| format!("PDF nicht gefunden: {error}"))?;
    if (reject_reparse && is_reparse_point(&canonical_metadata))
        || !canonical_metadata.file_type().is_file()
    {
        return Err("Der Pfad bezeichnet keine regulaere PDF-Datei".into());
    }
    Ok(canonical)
}

#[cfg(windows)]
fn reject_special_windows_prefix(path: &Path) -> Result<(), String> {
    use std::path::Prefix;

    let Some(Component::Prefix(prefix)) = path.components().next() else {
        return Err("Ungueltiger Windows-Dateipfad".into());
    };
    match prefix.kind() {
        Prefix::Disk(_)
        | Prefix::UNC(_, _)
        | Prefix::VerbatimDisk(_)
        | Prefix::VerbatimUNC(_, _) => Ok(()),
        _ => Err("Spezielle Windows-Geraetepfade sind nicht erlaubt".into()),
    }
}

#[cfg(not(windows))]
fn reject_special_windows_prefix(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(windows)]
fn paths_equal(left: &Path, right: &Path) -> bool {
    left.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
}

#[cfg(not(windows))]
fn paths_equal(left: &Path, right: &Path) -> bool {
    left == right
}

struct Sidecar {
    path: PathBuf,
    file: Option<File>,
    cleanup: bool,
}

impl Sidecar {
    fn create(target: &Path, tag: &str) -> Result<Self, String> {
        let start = NEXT_SIDECAR_ID.fetch_add(1, Ordering::Relaxed);
        Self::create_from(target, tag, start)
    }

    fn create_from(target: &Path, tag: &str, start: u64) -> Result<Self, String> {
        let parent = target
            .parent()
            .ok_or_else(|| "PDF hat keinen uebergeordneten Ordner".to_string())?;
        let name = target
            .file_name()
            .ok_or_else(|| "PDF hat keinen Dateinamen".to_string())?
            .to_string_lossy();

        for offset in 0..1000_u64 {
            let candidate = parent.join(format!(
                ".{name}.folio-{tag}-{}-{}",
                std::process::id(),
                start.wrapping_add(offset)
            ));
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&candidate)
            {
                Ok(file) => {
                    return Ok(Self {
                        path: candidate,
                        file: Some(file),
                        cleanup: true,
                    })
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!("Nebendatei konnte nicht erstellt werden: {error}"))
                }
            }
        }
        Err("Kein eindeutiger Name fuer die Nebendatei gefunden".into())
    }

    fn write_and_sync(&mut self, bytes: &[u8]) -> Result<(), String> {
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| "Nebendatei ist bereits geschlossen".to_string())?;
        file.write_all(bytes)
            .map_err(|error| format!("Schreiben fehlgeschlagen: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Synchronisieren fehlgeschlagen: {error}"))
    }

    fn close(&mut self) {
        self.file.take();
    }

    fn keep(&mut self) {
        self.cleanup = false;
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.file.take();
        if self.cleanup {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn save_atomically(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let metadata =
        std::fs::metadata(target).map_err(|error| format!("PDF nicht gefunden: {error}"))?;
    if metadata.permissions().readonly() {
        return Err("Die PDF ist schreibgeschuetzt".into());
    }

    let mut replacement = Sidecar::create(target, "tmp")?;
    replacement.write_and_sync(bytes)?;
    replacement.close();

    persist_replacement(target, &replacement.path)
}

#[cfg(windows)]
fn persist_replacement(target: &Path, replacement: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{ReplaceFileW, REPLACE_FILE_FLAGS},
    };

    let mut backup = Sidecar::create(target, "backup")?;
    backup.close();
    std::fs::remove_file(&backup.path)
        .map_err(|error| format!("Sicherungsname konnte nicht vorbereitet werden: {error}"))?;

    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let replacement_wide: Vec<u16> = replacement
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let backup_wide: Vec<u16> = backup
        .path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();

    let result = unsafe {
        ReplaceFileW(
            PCWSTR(target_wide.as_ptr()),
            PCWSTR(replacement_wide.as_ptr()),
            PCWSTR(backup_wide.as_ptr()),
            REPLACE_FILE_FLAGS(0),
            None,
            None,
        )
    };

    match result {
        Ok(()) => {
            let _ = std::fs::remove_file(&backup.path);
            Ok(())
        }
        Err(error) => handle_replace_failure(target, &mut backup, &error.to_string()),
    }
}

#[cfg(windows)]
fn handle_replace_failure(
    target: &Path,
    backup: &mut Sidecar,
    replace_error: &str,
) -> Result<(), String> {
    // Any backup produced by a failed replacement may be the only original.
    // Disarm cleanup before even querying metadata (which can itself fail).
    backup.keep();
    if !backup.path.is_file() {
        return Err(format!("Ersetzen fehlgeschlagen: {replace_error}"));
    }

    if !target.exists() {
        match std::fs::rename(&backup.path, target) {
            Ok(()) => return Err(format!("Ersetzen fehlgeschlagen: {replace_error}")),
            Err(restore_error) => {
                backup.keep();
                return Err(format!(
                    "Ersetzen fehlgeschlagen ({replace_error}); Original liegt sicher unter {} und konnte nicht an seinen Ausgangsort zurueckgeschoben werden: {restore_error}",
                    backup.path.display()
                ));
            }
        }
    }

    // Bei einem teilweisen ReplaceFileW-Fehler oder einem gleichzeitigen externen
    // Zugriff kann das Backup die einzige unveraenderte Kopie sein.
    backup.keep();
    Err(format!(
        "Ersetzen fehlgeschlagen ({replace_error}); unveraenderte Sicherung liegt unter {}",
        backup.path.display()
    ))
}

#[cfg(not(windows))]
fn persist_replacement(_target: &Path, _replacement: &Path) -> Result<(), String> {
    Err("Sicheres Ersetzen wird auf diesem System nicht unterstuetzt".into())
}

#[cfg(windows)]
fn recycle_native(path: PathBuf) -> Result<(), String> {
    std::thread::spawn(move || recycle_on_sta(&path))
        .join()
        .map_err(|_| "Windows-Papierkorboperation ist unerwartet abgebrochen".to_string())?
}

#[cfg(not(windows))]
fn recycle_native(_path: PathBuf) -> Result<(), String> {
    Err("Verschieben in den Papierkorb wird auf diesem System nicht unterstuetzt".into())
}

#[cfg(windows)]
fn recycle_on_sta(path: &Path) -> Result<(), String> {
    use std::{os::windows::ffi::OsStrExt, sync::Arc};
    use windows::{
        core::{implement, Error, Ref, HRESULT, PCWSTR},
        Win32::{
            Foundation::E_ABORT,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{
                FileOperation, IFileOperation, IFileOperationProgressSink,
                IFileOperationProgressSink_Impl, IShellItem, SHCreateItemFromParsingName,
                FOFX_EARLYFAILURE, FOFX_RECYCLEONDELETE, FOF_NOCONFIRMATION, FOF_NOERRORUI,
                FOF_SILENT, TSF_DELETE_RECYCLE_IF_POSSIBLE,
            },
        },
    };

    #[derive(Default)]
    struct Outcome {
        callback_seen: bool,
        recycled: bool,
        delete_error: Option<HRESULT>,
    }

    #[implement(IFileOperationProgressSink)]
    struct RecycleOnlySink {
        outcome: Arc<Mutex<Outcome>>,
    }

    #[allow(non_snake_case, unused_variables)]
    impl IFileOperationProgressSink_Impl for RecycleOnlySink_Impl {
        fn StartOperations(&self) -> windows::core::Result<()> {
            Ok(())
        }
        fn FinishOperations(&self, hrresult: HRESULT) -> windows::core::Result<()> {
            Ok(())
        }
        fn PreRenameItem(
            &self,
            dwflags: u32,
            psiitem: Ref<'_, IShellItem>,
            psznewname: &PCWSTR,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn PostRenameItem(
            &self,
            dwflags: u32,
            psiitem: Ref<'_, IShellItem>,
            psznewname: &PCWSTR,
            hrrename: HRESULT,
            psinewlycreated: Ref<'_, IShellItem>,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn PreMoveItem(
            &self,
            dwflags: u32,
            psiitem: Ref<'_, IShellItem>,
            psidestinationfolder: Ref<'_, IShellItem>,
            psznewname: &PCWSTR,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn PostMoveItem(
            &self,
            dwflags: u32,
            psiitem: Ref<'_, IShellItem>,
            psidestinationfolder: Ref<'_, IShellItem>,
            psznewname: &PCWSTR,
            hrmove: HRESULT,
            psinewlycreated: Ref<'_, IShellItem>,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn PreCopyItem(
            &self,
            dwflags: u32,
            psiitem: Ref<'_, IShellItem>,
            psidestinationfolder: Ref<'_, IShellItem>,
            psznewname: &PCWSTR,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn PostCopyItem(
            &self,
            dwflags: u32,
            psiitem: Ref<'_, IShellItem>,
            psidestinationfolder: Ref<'_, IShellItem>,
            psznewname: &PCWSTR,
            hrcopy: HRESULT,
            psinewlycreated: Ref<'_, IShellItem>,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn PreDeleteItem(
            &self,
            dwflags: u32,
            psiitem: Ref<'_, IShellItem>,
        ) -> windows::core::Result<()> {
            if dwflags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 == 0 {
                return Err(Error::new(
                    E_ABORT,
                    "Windows meldet keine Papierkorboperation",
                ));
            }
            Ok(())
        }
        fn PostDeleteItem(
            &self,
            dwflags: u32,
            psiitem: Ref<'_, IShellItem>,
            hrdelete: HRESULT,
            psinewlycreated: Ref<'_, IShellItem>,
        ) -> windows::core::Result<()> {
            if let Ok(mut outcome) = self.outcome.lock() {
                outcome.callback_seen = true;
                outcome.delete_error = (!hrdelete.is_ok()).then_some(hrdelete);
                outcome.recycled = hrdelete.is_ok()
                    && dwflags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 != 0
                    && !psinewlycreated.is_null();
            }
            Ok(())
        }
        fn PreNewItem(
            &self,
            dwflags: u32,
            psidestinationfolder: Ref<'_, IShellItem>,
            psznewname: &PCWSTR,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn PostNewItem(
            &self,
            dwflags: u32,
            psidestinationfolder: Ref<'_, IShellItem>,
            psznewname: &PCWSTR,
            psztemplatename: &PCWSTR,
            dwfileattributes: u32,
            hrnew: HRESULT,
            psinewitem: Ref<'_, IShellItem>,
        ) -> windows::core::Result<()> {
            Ok(())
        }
        fn UpdateProgress(&self, iworktotal: u32, iworksofar: u32) -> windows::core::Result<()> {
            Ok(())
        }
        fn ResetTimer(&self) -> windows::core::Result<()> {
            Ok(())
        }
        fn PauseTimer(&self) -> windows::core::Result<()> {
            Ok(())
        }
        fn ResumeTimer(&self) -> windows::core::Result<()> {
            Ok(())
        }
    }

    struct ComApartment;
    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    initialized
        .ok()
        .map_err(|error| format!("Windows COM konnte nicht initialisiert werden: {error}"))?;
    let _apartment = ComApartment;

    // canonicalize returns an extended-length path; Shell parsing expects the
    // ordinary drive/UNC spelling even though file APIs accept the prefix.
    let mut wide_path: Vec<u16> = path.as_os_str().encode_wide().collect();
    let extended_unc: Vec<u16> = "\\\\?\\UNC\\".encode_utf16().collect();
    let extended: Vec<u16> = "\\\\?\\".encode_utf16().collect();
    if wide_path.starts_with(&extended_unc) {
        wide_path = "\\\\".encode_utf16().chain(wide_path.into_iter().skip(8)).collect();
    } else if wide_path.starts_with(&extended) {
        wide_path.drain(..4);
    }
    wide_path.push(0);
    let item: IShellItem = unsafe {
        SHCreateItemFromParsingName(PCWSTR(wide_path.as_ptr()), None)
            .map_err(|error| format!("PDF konnte nicht an Windows uebergeben werden: {error}"))?
    };
    let operation: IFileOperation = unsafe {
        CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| format!("Windows-Papierkorb ist nicht verfuegbar: {error}"))?
    };
    let flags =
        FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE | FOF_NOERRORUI | FOF_NOCONFIRMATION | FOF_SILENT;
    unsafe {
        operation
            .SetOperationFlags(flags)
            .map_err(|error| format!("Papierkorbmodus konnte nicht gesetzt werden: {error}"))?;
    }

    let outcome = Arc::new(Mutex::new(Outcome::default()));
    let sink: IFileOperationProgressSink = RecycleOnlySink {
        outcome: Arc::clone(&outcome),
    }
    .into();
    unsafe {
        operation.DeleteItem(&item, &sink).map_err(|error| {
            format!("Papierkorboperation konnte nicht vorbereitet werden: {error}")
        })?;
        operation
            .PerformOperations()
            .map_err(|error| format!("Verschieben in den Papierkorb fehlgeschlagen: {error}"))?;
        if operation
            .GetAnyOperationsAborted()
            .map_err(|error| format!("Papierkorbstatus konnte nicht gelesen werden: {error}"))?
            .as_bool()
        {
            return Err("Verschieben in den Papierkorb wurde abgebrochen".into());
        }
    }

    let outcome = outcome
        .lock()
        .map_err(|_| "Papierkorbstatus ist nicht verfuegbar".to_string())?;
    if let Some(error) = outcome.delete_error {
        return Err(format!("Windows konnte die PDF nicht recyceln: {error:?}"));
    }
    if !outcome.callback_seen || !outcome.recycled || path.exists() {
        return Err("Windows hat nicht bestaetigt, dass die PDF im Papierkorb liegt".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let id = NEXT_TEST.fetch_add(1, Ordering::Relaxed);
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("work")
                .join("rust-tests")
                .join(format!("{}-{id}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self(std::fs::canonicalize(path).unwrap())
        }

        fn pdf(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let test_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("work")
                .join("rust-tests");
            if self.0.starts_with(test_root) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn hex_decode_accepts_utf8_and_rejects_non_ascii_without_panicking() {
        assert_eq!(
            decode_hex_path("433a5c6dc3bc2e706466").unwrap(),
            "C:\\mue.pdf".replace("mue", "mü")
        );
        assert!(decode_hex_path("0é0").is_err());
        assert!(decode_hex_path("abc").is_err());
    }

    #[test]
    fn unique_sidecar_never_overwrites_a_collision() {
        let dir = TestDir::new();
        let target = dir.pdf("collision.pdf", b"original");
        let collision = target.parent().unwrap().join(format!(
            ".collision.pdf.folio-tmp-{}-42",
            std::process::id()
        ));
        std::fs::write(&collision, b"keep me").unwrap();

        let sidecar = Sidecar::create_from(&target, "tmp", 42).unwrap();

        assert_ne!(sidecar.path, collision);
        assert_eq!(std::fs::read(collision).unwrap(), b"keep me");
    }

    #[cfg(windows)]
    #[test]
    fn successful_save_replaces_contents_and_removes_sidecars() {
        let dir = TestDir::new();
        let target = dir.pdf("success.pdf", b"old");

        save_atomically(&target, b"new pdf bytes").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"new pdf bytes");
        let names: Vec<_> = std::fs::read_dir(&dir.0)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![target.file_name().unwrap()]);
    }

    #[cfg(windows)]
    #[test]
    fn locked_target_save_failure_preserves_original() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = TestDir::new();
        let target = dir.pdf("locked.pdf", b"original bytes");
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&target)
            .unwrap();

        assert!(save_atomically(&target, b"replacement").is_err());
        drop(lock);
        assert_eq!(std::fs::read(&target).unwrap(), b"original bytes");
    }

    #[test]
    fn missing_target_is_never_created_by_save() {
        let dir = TestDir::new();
        let target = dir.0.join("missing.pdf");

        assert!(save_atomically(&target, b"replacement").is_err());
        assert!(!target.exists());
    }

    #[cfg(windows)]
    #[test]
    fn failed_restore_never_deletes_the_only_backup() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = TestDir::new();
        let target = dir.0.join("vanished.pdf");
        let mut backup = Sidecar::create(&target, "backup-test").unwrap();
        backup.write_and_sync(b"the original").unwrap();
        backup.close();
        let locked_backup = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&backup.path)
            .unwrap();

        let error = handle_replace_failure(&target, &mut backup, "injected failure").unwrap_err();

        assert!(error.contains("Original liegt sicher"));
        assert!(backup.path.exists());
        drop(locked_backup);
        assert_eq!(std::fs::read(&backup.path).unwrap(), b"the original");
        std::fs::remove_file(&backup.path).unwrap();
    }

    #[test]
    fn open_pdf_cannot_be_recycled() {
        let dir = TestDir::new();
        let target = dir.pdf("open.pdf", b"%PDF-fixture");
        let state = FileState::default();
        state
            .read_and_register("document-window", target.to_str().unwrap())
            .unwrap();

        let error = state.recycle(target.to_str().unwrap()).unwrap_err();

        assert!(error.contains("noch in einem Folio-Fenster"));
        assert!(target.exists());
    }

    #[cfg(windows)]
    #[test]
    fn readonly_pdf_is_preserved_on_save_failure() {
        let dir = TestDir::new();
        let target = dir.pdf("readonly.pdf", b"original");
        let mut permissions = std::fs::metadata(&target).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&target, permissions.clone()).unwrap();
        let result = save_atomically(&target, b"replacement");
        permissions.set_readonly(false);
        std::fs::set_permissions(&target, permissions).unwrap();
        assert!(result.is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "Explicit smoke test: recycles one self-created disposable PDF in work/rust-tests"]
    fn recycle_disposable_pdf_smoke() {
        let dir = TestDir::new();
        let target = dir.pdf("Folio-Papierkorb-Test.pdf", b"%PDF-1.4\n% Folio disposable recycle test\n%%EOF\n");
        let state = FileState::default();
        state.read_and_register("test-window", target.to_str().unwrap()).unwrap();
        state.forget_window("test-window");
        state.recycle(target.to_str().unwrap()).unwrap();
        assert!(!target.exists());
        println!("Windows confirmed a newly created Recycle Bin item for {}", target.display());
    }
}
