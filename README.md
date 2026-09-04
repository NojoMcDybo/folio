# Folio

PDF-Reader für Windows. Tauri v2 (Rust + WebView2), Frontend in TypeScript mit PDF.js.

## Stand

- PDF öffnen: Dialog, Drag & Drop, Kommandozeilenargument, Dateizuordnung `.pdf`
- Fortlaufendes Scrollen, Seiten werden nur im Sichtbereich gerendert
- Zoom mit Strg+Rad, Ankerpunkt bleibt beim Zoomen erhalten
- Farb-Invertierung für dunkles Lesen (Strg+I)
- Textebene: markieren und kopieren
- Volltextsuche (Strg+F)
- Single-Instance: ein Prozess für alle geöffneten Dateien

## Tastatur

| | |
|---|---|
| Strg+O | Öffnen |
| Strg+F | Suchen |
| Strg+I | Invertieren |
| Strg + Rad | Zoom |
| Strg+0 | Passbreite |
| F3 | nächster Treffer |

## Entwickeln

Voraussetzungen: Node 20+, Rust (stable-msvc), VS Build Tools mit C++-Workload.

```
npm install
npm run tauri dev      # Entwicklung mit Hot Reload
npm run tauri build    # Release + NSIS-Installer
```

Hinweis: Falls `NODE_ENV=production` gesetzt ist, lässt npm die devDependencies weg.
Die `.npmrc` im Projekt fängt das ab.

## Lizenzen der Bausteine

PDF.js (Apache-2.0), Tauri (MIT/Apache-2.0). MuPDF wird bewusst nicht verwendet — AGPL.
