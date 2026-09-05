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

## Tastatur

| | |
|---|---|
| Strg+O | Öffnen |
| Strg+F | Suchen |
| Strg+S | Sichern |
| Strg+I | Invertieren |
| Strg + Rad | Zoom |
| Strg+0 | Ausgangsbreite |
| F3 | nächster Treffer |
| F11 | Bedienung aus |
| M / Z / T | Marker, Stift, Textfeld |
| V | Werkzeug weg |

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

PDF.js (Apache-2.0), Tauri (MIT/Apache-2.0). MuPDF wird bewusst nicht verwendet — AGPL.
