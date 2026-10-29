# Folio

PDF-Reader für Windows. Tauri v2 (Rust + WebView2), Frontend in TypeScript mit PDF.js.

## Stand

- Bibliothek als eigenes Fenster, zuletzt geöffnete Dokumente als Kacheln
- Jedes Dokument in einem eigenen Fenster, dieselbe Datei kommt nach vorn
- PDF öffnen: Dialog, Drag & Drop, Kommandozeilenargument, Dateizuordnung `.pdf`
- Rahmenloses Fenster, Bedienung schwebt in Glas darüber, F11 blendet sie aus
- Glas auf WebGL: Brechung des Seiteninhalts, kein Kunstlicht
- Suche, Invertierung und Werkzeuge lassen sich frei hinschieben
- Textmarker, Stift und Textfeld, Änderungen werden ins PDF zurückgeschrieben
- Fortlaufendes Scrollen, Seiten werden nur im Sichtbereich gerendert
- Zoom mit Strg+Rad, Ankerpunkt bleibt beim Zoomen erhalten
- Single-Instance: ein Prozess für alle geöffneten Dateien
- Seitenleiste nur mit Miniaturen: per Griff am linken Rand, Wischen mit zwei Fingern oder Strg+B heraus- und wieder hineinziehen
- Kontaktbogen (K): alle Seiten als Raster
- Ansicht: fortlaufend, Einzelseite, Doppelseite (Knopf neben dem Inhaltsverzeichnis)
- Eigene Lesezeichen pro Dokument (Strg+D), unabhängig vom Dateipfad
- Seiten bearbeiten: Miniaturen ziehen zum Umsortieren, Entf löscht, Strg+, / Strg+. dreht, Zuschneiden mit Rahmen, PDFs einfügen
  (Dialog oder auf die Leiste ziehen), mehrere PDFs zusammenführen, Seiten als eigene PDF sichern, in die Notch-Ablage legen oder aus dem Fenster
  in den Explorer bzw. in die Bibliothek ziehen. Alles lässt sich mit Strg+Z zurücknehmen; geschrieben wird erst beim Sichern.
- Texterkennung (Windows.Media.Ocr, offline) für Seiten ohne eigenen Text: erkannte Wörter lassen sich markieren und kopieren,
  Adressen, E-Mails und Telefonnummern werden zu Links; Rechtsklick auf Text: kopieren, nachschlagen, übersetzen, im Web suchen.
  Optional wird der erkannte Text unsichtbar ins PDF geschrieben (durchsuchbar in jedem Programm). Braucht das Windows-Sprachpaket.
- Unterschreiben (Strg+Umschalt+U): QR-Code scannen, am Handy im Browser unterschreiben, die Unterschrift landet als verschiebbarer Stempel
  im Dokument. Läuft nur über das eigene WLAN (kleiner lokaler Server mit Einmal-Schlüssel, 10 Minuten gültig); alternativ im Fenster
  zeichnen oder eine gemerkte Unterschrift wiederverwenden.
- Verkleinern und umwandeln (Menü Ansicht): Bilder auf 100/150/220 dpi, Schwarzweiß, Anmerkungen und Formularfelder einbrennen –
  als Kopie sichern oder auf das Dokument anwenden (rückgängig machbar). Dasselbe ohne Fenster: `folio --compress|--gray|--flatten <PDF>`,
  siehe [docs/notch-integration.md](docs/notch-integration.md).
- Inhaltsverzeichnis: ohne Lesezeichen in der Datei liest Folio ein gedrucktes Verzeichnis oder erkennt Überschriften an ihrer Größe.

## Tastatur

| | |
|---|---|
| Strg+O | Öffnen |
| Strg+F | Suchen |
| Strg+S | Sichern |
| Strg+I | Invertieren |
| Strg+B | Seitenleiste |
| K | Kontaktbogen |
| Strg+D | Lesezeichen setzen/entfernen |
| Bild↑ / Bild↓ | Seite blättern (Einzel-/Doppelseite) |
| Strg+Z / Strg+Y | Seitenoperation zurück / wiederholen |
| Strg+, / Strg+. | Seite(n) links / rechts drehen |
| Entf | markierte Seiten löschen (Seitenleiste) |
| Strg-/Umschalt-Klick | Seiten markieren |
| Strg + Rad | Zoom |
| Strg+0 | Ausgangsbreite |
| F3 | nächster Treffer |
| F11 | Bedienung aus |
| M / Z / T | Marker, Stift, Textfeld |
| V | Werkzeug weg |

## Kommandozeile

```
folio --compress <PDF> [--preset screen|mail|print] [--out <Datei>]
folio --gray <PDF>        folio --flatten <PDF>        folio --optimize <PDF> --dpi 150 --gray --flatten
```
Arbeitet ohne Fenster, schreibt nie über eine vorhandene Datei und liefert einen JSON-Bericht (Details: `docs/notch-integration.md`).

## Tests

`npm test` (Logik), `cargo test -p folio-pdfops` im Ordner `src-tauri` (PDF-Bearbeitung, Unterschriften-Server, Kommandozeile),
`tests/browser` (Oberfläche im Chromium, siehe dort).

## Entwickeln

Voraussetzungen: Node 20+, Rust (stable-msvc), VS Build Tools mit C++-Workload.

```
npm install
npm run tauri dev      # Entwicklung mit Hot Reload
npm run tauri build    # Release + NSIS-Installer
```

Hinweis: Werkzeuge, die aus einer Umgebung mit `NODE_ENV=production` heraus starten
(etwa ein Terminal, das eine Electron-App geerbt hat), lassen die devDependencies weg.
Die `.npmrc` im Projekt (`include=dev`) fängt das ab. In einer normalen Eingabe-
aufforderung ist nichts zu tun.

## Lizenzen der Bausteine

PDF.js (Apache-2.0), Tauri (MIT/Apache-2.0), lopdf (MIT, Drehen/Zuschneiden), tauri-plugin-drag (MIT/Apache-2.0). MuPDF wird bewusst nicht verwendet — AGPL.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
