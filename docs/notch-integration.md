# Notch: PDFs komprimieren und schwarzweiß stellen

Die Notch bietet für abgelegte PDFs unter „Umwandeln in …“ zusätzlich an:

| Ziel | Aufruf | Ergebnis |
|---|---|---|
| Komprimieren · E-Mail | `folio --compress <PDF> --preset mail` | Bilder auf 150 dpi, JPEG 70 |
| Komprimieren · klein | `folio --compress <PDF> --preset screen` | Bilder auf 100 dpi, JPEG 55 |
| Schwarzweiß | `folio --gray <PDF>` | Bilder und Farben grau |

Beides sind getrennte Funktionen. Das Ergebnis landet wie bei den anderen Umwandlungen **neben dem Original**
(`Name (komprimiert).pdf`, `Name (schwarzweiß).pdf`), wird nie überschrieben und kommt in die Ablage.

## Schnittstelle von Folio (ab 0.13.0)

`folio.exe --compress|--gray|--flatten|--optimize <PDF> [Optionen]` arbeitet ohne Fenster und beendet sich danach.

| Option | Bedeutung |
|---|---|
| `--out <Datei>` | Ziel. Existiert sie schon, passiert nichts (Rückgabe 3). Ohne Angabe: neben dem Original, mit freiem Namen |
| `--preset screen\|mail\|print` | 100 / 150 / 220 dpi |
| `--dpi N`, `--quality N` | eigene Werte (Qualität 10–100) |
| `--gray`, `--flatten` | zusätzlich in Grau umrechnen / Anmerkungen und Formularfelder einbrennen |
| `--report <Datei>` | Bericht als JSON; er steht auch auf stdout |

Rückgabe: `0` fertig · `1` Fehler beim Verarbeiten (Meldung auf stderr) · `2` falscher Aufruf · `3` Ziel existiert.
Der Bericht enthält `output`, `before`, `after`, `images`, `recompressed`, `flattened` und `warnings`.
Wird eine Datei dadurch nicht kleiner, bleibt der Inhalt unverändert (`warnings` sagt es); die Datei entsteht trotzdem.

## Der Patch

`notch-pdf-convert.patch` gehört in das Repository `NojoMcDybo/notch` (`src-tauri/src/convert.rs`, getestet gegen
Notch 0.2.23, `cargo check --target x86_64-pc-windows-gnu` ist sauber):

```
cd D:\Dev\notch
git apply D:\Dev\folio\docs\notch-pdf-convert.patch
```

Folio wird gefunden über `FOLIO_EXE`, `%LOCALAPPDATA%\Folio\folio.exe`, `%LOCALAPPDATA%\Programs\Folio\folio.exe` und
`%ProgramFiles%\Folio\folio.exe`. Ist Folio nicht installiert, erscheinen die Ziele gar nicht.
Die Oberfläche der Notch braucht keine Änderung: sie zeigt, was `convert_targets` liefert.

Bis das eingespielt ist, geht dasselbe von Hand: `folio --compress "C:\...\Bericht.pdf" --preset mail`.
