# Folio für Windows

## Installation

`Folio_0.8.0_x64-setup.exe` installiert Folio auf Windows 10 und 11 (64 Bit, Intel/AMD).
Die benötigte Microsoft-WebView2-Laufzeit ist im Paket enthalten. Zur Installation
ist keine Internetverbindung nötig. Eine bereits vorhandene Laufzeit wird verwendet.

1. Das Setup per Doppelklick starten.
2. Den Installationsordner auswählen. Folio wird für das aktuelle Windows-Konto installiert.
3. Auf der Abschlussseite „Desktop-Verknüpfung erstellen“ nach Wunsch aktiviert lassen.

Folio ist anschließend über das Startmenü und die Desktop-Verknüpfung erreichbar.
Der Installer registriert Folio als PDF-Anwendung und verwendet das eigene PDF-Symbol.
Windows verwaltet die Wahl der Standardanwendung separat.

Das Paket ist noch nicht mit einem Herausgeberzertifikat signiert. Windows kann
deshalb beim Start eine SmartScreen-Meldung anzeigen.

## Aktualisieren und deinstallieren

Für ein Update Folio schließen und das neue Setup starten. Bibliothek und
Einstellungen bleiben bei einem normalen Update erhalten. Ältere Versionen werden
vom Installer nicht über eine neuere Version installiert.

Die Deinstallation erfolgt über **Windows-Einstellungen → Apps → Installierte Apps → Folio**.
Persönliche App-Daten werden nur gelöscht, wenn dies im Deinstallationsdialog
ausgewählt wird. Die eigenen PDF-Dateien werden durch die Deinstallation nicht gelöscht.

„Folio Test“ bleibt eine getrennte App. Seine Bibliothek wird nicht automatisch
in die reguläre Folio-Installation übertragen.

## Neues Menü in der Bibliothek

- **Speicherort öffnen:** öffnet den Explorer und markiert die ausgewählte PDF.
- **Aus Bibliothek entfernen:** entfernt nur den Eintrag; die Datei bleibt erhalten.
- **In den Papierkorb:** verschiebt die Datei nach Bestätigung in den Windows-Papierkorb.

## Installer erneut bauen

Auf einem Windows-Entwicklungsrechner mit Node.js, Rust und den Tauri-Buildwerkzeugen:

```powershell
npm ci
npm run installer:build
```

Ausgabe: `src-tauri/target/release/bundle/nsis/Folio_0.8.0_x64-setup.exe`.
Beim ersten Build wird der offizielle Microsoft-WebView2-Offline-Installer
heruntergeladen; er bleibt danach im lokalen Tauri-Cache.

## Arbeitsstand

Diese Änderungen liegen in `D:\Dev\folio-installer` auf `codex/library-installer`,
ausgehend von `1dff679`. Die zuvor ungespeicherten neuen Symbole und PDF-Registrierungen
aus `D:\Dev\folio` wurden übernommen. Das Ausgangsverzeichnis wurde nicht bearbeitet.
