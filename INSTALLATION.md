# Folio für Windows

## Installation

`Folio_0.8.4_x64-setup.exe` installiert Folio auf Windows 10 und 11 (64 Bit, Intel/AMD).
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

Ab 0.8.4 prüft Folio 15 s nach dem Start und danach alle 6 h, ob es auf GitHub eine
neue Version gibt, und zeigt sie oben in der Bibliothek an. **Installieren** lädt das
Update, prüft die Signatur (Schlüssel `plugins.updater.pubkey` in `tauri.conf.json`)
und startet Folio danach neu. Vorher müssen alle Dokumentfenster geschlossen sein,
damit keine ungesicherten Markierungen verloren gehen. Ein Update lädt den vollen
Installer (mit WebView2, rund 210 MB).

Ältere Versionen (bis 0.8.3) einmal von Hand aktualisieren: Folio schließen und das
neue Setup von der Releases-Seite starten. Bibliothek und Einstellungen bleiben bei
einem normalen Update erhalten. Ältere Versionen werden vom Installer nicht über eine
neuere Version installiert.

Neue Version veröffentlichen: Version in `package.json`, `src-tauri/Cargo.toml` und
`src-tauri/tauri.conf.json` anheben, committen, Tag `v<version>` pushen. Der Workflow
baut, signiert (Secret `TAURI_SIGNING_PRIVATE_KEY`) und lädt Installer und
`latest.json` ins Release.

Die Deinstallation erfolgt über **Windows-Einstellungen → Apps → Installierte Apps → Folio**.
Persönliche App-Daten werden nur gelöscht, wenn dies im Deinstallationsdialog
ausgewählt wird. Die eigenen PDF-Dateien werden durch die Deinstallation nicht gelöscht.

„Folio Test“ bleibt eine getrennte App. Seine Bibliothek wird nicht automatisch
in die reguläre Folio-Installation übertragen.

## Neues Menü in der Bibliothek

- **Speicherort öffnen:** öffnet den Explorer und markiert die ausgewählte PDF.
- **Aus Bibliothek entfernen:** entfernt nur den Eintrag; die Datei bleibt erhalten.
- **In den Papierkorb:** verschiebt die Datei nach Bestätigung in den Windows-Papierkorb.

## Glasdarstellung auf anderen PCs

Ab 0.8.1 nutzt Folio automatisch WebGL 2, bei Bedarf WebGL 1 und andernfalls
einen Canvas-Ersatz mit Lichtbrechung. Auch ein Grafikausfall während des Lesens
aktiviert den Ersatz. Dieser zeichnet mit geringerer Detailauflösung und Bildrate,
damit ältere PCs bedienbar bleiben. Dafür müssen keine Grafik-Sicherheitsregeln
im Browser oder System abgeschaltet werden.

Die Windows-Vorgabe für reduzierte Transparenz und Kontrastdesigns wird weiterhin
berücksichtigt. Ist reduzierte Transparenz aktiv, sind die Flächen bewusst deckend.
Unter Windows 11 lässt sich dies unter **Einstellungen → Barrierefreiheit →
Visuelle Effekte → Transparenzeffekte** prüfen.

## Installer erneut bauen

Auf einem Windows-Entwicklungsrechner mit Node.js, Rust und den Tauri-Buildwerkzeugen:

```powershell
npm ci
npm run installer:build
```

Ausgabe: `src-tauri/target/release/bundle/nsis/Folio_0.8.4_x64-setup.exe`.
Beim ersten Build wird der offizielle Microsoft-WebView2-Offline-Installer
heruntergeladen; er bleibt danach im lokalen Tauri-Cache.
