# Browser-Tests

Folio laeuft hier im Chromium (Playwright); der native Teil (Tauri) wird in `harness.cjs` nachgestellt.
Wo Folio sonst Rust aufruft, laeuft in Node dieselbe Rust-Bibliothek `folio-pdfops` als kleines Programm
(`src-tauri/pdfops/examples`): Drehen/Zuschneiden, Text einbetten, Verkleinern/Schwarzweiss und der
Unterschriften-Server sind also echter Code, nicht nachgebaut. Nicht abgedeckt sind Windows-Teile: OCR,
nativer Drag, Papierkorb, Dialoge.

Voraussetzungen: Node, `npm i --no-save playwright` (dazu `npx playwright install chromium`), Python mit
`reportlab`, `Pillow`, `pypdf`, Rust.

```
python3 tests/browser/make-fixtures.py
(cd src-tauri && cargo build -p folio-pdfops --examples)
npm run dev                       # in einem zweiten Fenster, Port 1420
node tests/browser/sidebar.cjs    # oder: sh tests/browser/run-all.sh
```

| Datei | prueft |
|---|---|
| `sidebar.cjs` | Seitenleiste (Wischen, Ziehen, Griff, Strg+B), Ansichten, Kontaktbogen, Lesezeichen |
| `pages.cjs` | Drehen, Loeschen, Umsortieren, Einfuegen, Zuschneiden, Extrahieren, Herausziehen, Rueckgaengig |
| `drop-merge.cjs` | PDF auf die Leiste ziehen, Seiten in die Bibliothek ziehen, Zusammenfuehren |
| `outline-detect.cjs` | Inhaltsverzeichnis aus gedrucktem Verzeichnis und aus Ueberschriften |
| `ocr.cjs` | Texterkennungsebene, Links, Kontextmenue, Text einbetten |
| `signing.cjs` | Unterschrift: Handy-Seite vom echten Server, Stempel, Speichern |
| `optimize.cjs` | Verkleinern, Schwarzweiss, auf Dokument anwenden, Rueckgaengig |

Ergebnisse und Bildschirmfotos landen in `work/browser/`.
