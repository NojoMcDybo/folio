# Folio: klare Glasoberflaeche

## Richtung

Apple-inspirierte, zurueckhaltende Bedienelemente ueber dem Dokument. Die Anwendung bleibt ein Windows-PDF-Reader. Schrift und selbst gezeichnete SVG-Symbole sind lokal vorhanden; keine neue UI-Bibliothek oder extern geladenen Fonts.

Referenz: [Apple: Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/). Die Ideen sind schwebende, zusammenpassende Formen, Lichtbrechung zur Trennung vom Inhalt und lesbare Bedienelemente. Die Umsetzung ist eigener Code auf Basis des vorhandenen PDF-Canvas-Backdrops. Die Recherche zu [ybouane/liquidglass](https://github.com/ybouane/liquidglass) wurde als technischer Vergleich verwendet; kein Bibliothekscode wurde uebernommen.

## Farben, Geometrie und Bewegung

| Eigenschaft | Wert / Verhalten |
| --- | --- |
| Lesehintergrund | Neutrales Anthrazit `#202020` |
| Bibliothek | `#1c1c1e` |
| Schrift | Segoe UI Variable / Windows-Systemschrift |
| Primaere Schrift | `#f5f5f7` |
| Sekundaere Schrift | `#a1a1a6` |
| Akzent | Helles Blau `#75b8ff`; nur Auswahl und Fokus |
| Hauptknoepfe | 40 Pixel, kreisrund |
| Lupe | 160 Pixel Sichtflaeche, 194 Pixel aussen, 2,5x |
| Hover | Leichte Aufhellung, kein ausgedehnter Symbolschein |
| Druecken | Kurze Skalierung auf 93 Prozent |
| Weniger Bewegung | CSS folgt prefers-reduced-motion |

## Glas und Lesbarkeit

- Lichtbrechung vorwiegend am Rand, auf wenige Pixel begrenzt. Keine RGB-Aufspaltung und keine adaptive Abdunklung der Glasflaeche.
- Pixelabdeckung aus der Distanzfunktion mit Ableitungen; Zeichenrechteck geht ueber die Kontur hinaus. So wird die aeussere Kantenglaettung nicht abgeschnitten.
- Die Aufloesung folgt der Bildschirmskalierung und den GPU-Grenzen. Der bisherige pauschale vierfache Vollbild-Renderpuffer und die Symboltexturen entfallen.
- Symbole bleiben DOM-Vektoren. Eine kleine Helligkeitskarte des Dokumenthintergrunds steuert helle/dunkle Symbolfarben, mit Hysterese gegen Flackern an Seitenraendern.
- Suchleiste nutzt etwas mehr Streuung. Der Speicherdialog hat einen eigenen lesbaren Standardhintergrund.
- CSS-Ersatzdarstellung bei fehlendem/verlorenem WebGL-Kontext; Kontextwiederherstellung baut die Ressourcen neu auf. Einstellungen fuer reduzierte Transparenz und Windows-Kontrastmodus werden beruecksichtigt.

## Bedienelemente

- Textmarker: breite, senkrechte Keilform mit Unterstreichung; Zeichenstift bleibt schmal und diagonal.
- Anmerkungsmenue: allgemeines Werkzeugkasten-Symbol statt eines zweiten Stifts. Auswahlzustand wird am jeweiligen Werkzeug angezeigt.
- Buttons haben zugaengliche Namen, Werkzeugauswahl aria-pressed, Menueoeffner aria-expanded, Suchfeld einen Namen und Platzhalter. Sichtbarer Tastaturfokus.
- Freies Verschieben und Tastaturkuerzel bleiben erhalten. Positionsbegrenzung haelt Bedienelemente nach dem Verkleinern erreichbar.
- F11 blendet auch die gesamte offene Werkzeuggruppe aus.
- Version 0.2.1: Kleine und ausgeklappte Scrollleiste haben auf Benutzerwunsch eine hellere, neutralweisse Glasflaeche und einen weichen weissen Schein. Der Fortschritt bleibt durch eine weitere Aufhellung unterscheidbar.

## Grenzen dieser Runde

### Lesekomfort in 0.3.0

- Seitenzahl erscheint beim Hover und bleibt unter dem Cursor sichtbar; dort zeigt sie die aktuelle Seite statt eines eventuell zuvor eingeblendeten Zoomwerts. F11 blendet sie weiterhin aus.
- Doppelklick auf freie Seitenflaeche wechselt zu Seitenbreite und zurueck zum vorherigen Zoom. Bei Fensterwechsel bleibt der vergroesserte Modus auf Seitenbreite. Strg+Mausrad beendet diesen Modus; Strg+0 setzt auf die bisherige Anfangsgroesse zurueck. Textauswahl, Links/Formulare und Anmerkungswerkzeuge werden ausgespart.
- Gemeinsame CSS-Variable fuer Invertierung in PDF, Lupe und Glas: bestehende Umwandlung plus `saturate(0.65)`. Das mindert auch andere Farbstiche und kraeftige Farben. Graustufen bleiben neutral. Keine Behauptung, die Ursache des benutzerspezifischen Violettstichs sei bereits nachgewiesen.
- Browserpruefung mit echter Test-PDF: Hover nach Ausblendung und ueber Timeout hinaus, F11 waehrend Hover, Vergroessern/Rueckkehr, Fensteranpassung, Wortauswahl, Zeichenmodus. Farbprobe: graue Kanaele 94/94/94; Kanalspreizung leicht getoenter Probe von 8 auf 5 reduziert; Rot weiterhin erkennbar.

Keine neue Kapitel-/Seiten-Navigation, keine Loeschfunktion und keine Aenderung der Scrollgeschwindigkeiten. Der violette UI-Akzent wurde durch Blau ersetzt.

## Pruefung

Frontend-Build sowie Browserpruefung der produktiven Build-Dateien mit Edge/Chromium bei 100, 125 und 200 Prozent Skalierung. Echter PDF.js-Renderer und echte WebGL-Shader; Dateizugriff und Fensteraufrufe sind in dieser Browserpruefung ueber die offiziellen Tauri-Mocks ersetzt. Geprueft: Bibliothek, PDF-Darstellung, Suche, Werkzeuge, Lupe beim Ziehen, Invertierung, Symbolkontrast auf weisser Seite, F11 und Fenster bis 520 x 400. Native Version 0.2.0 als Update installiert, gestartet und Bibliothek gesichtet; vorhandene Eintraege weiterhin da. Weitere native Bedienung nach erkannter Benutzereingabe beendet.
