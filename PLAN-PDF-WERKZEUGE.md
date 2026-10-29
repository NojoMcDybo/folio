# Folio: PDF-Werkzeuge (Entwurf, offene Fragen unten)

Ausbau vom Reader zum Werkzeug. Grundlage ist der Stand auf GitHub `main` (0.8.4, Commit `491a773`). Abweichungen im lokalen Stand unter `D:\Dev\folio` sind hier nicht berücksichtigt.

## Was wir schon haben und was das ändert

- **PDF.js 6.3** bringt `PDFDocumentProxy.extractPages()` mit. Das kann zusammenführen, einfügen, löschen, umsortieren und extrahieren, sogar ein Bild als neue Seite einfügen, und nimmt die Editor-Anmerkungen dabei mit. **Für Seitenoperationen brauchen wir also keine neue Bibliothek.**
- PDF.js 6.3 hat außerdem einen Editor für Unterschriften (`AnnotationEditorType.SIGNATURE`) neben Marker, Stift und Textfeld.
- `PDFViewer` kann `ScrollMode` (vertikal, horizontal, umbrochen, seitenweise) und `SpreadMode` (Doppelseiten). Die Typen sind in `vite-env.d.ts` schon deklariert.
- **Eigene Textfelder über nicht ausfüllbaren Formularen** gibt es schon: das Textfeld-Werkzeug (T). Das AcroForm-Ausfüllen erledigt PDF.js.
- Die Notch hat schon die Ablage mit „Umwandeln in …“ (`convert.rs`, ruft ffmpeg extern auf) und einen LAN-Server mit QR-Code und Einmal-Schlüssel (`share.rs`, Port 53317, Firewall-Freigabe für private Netze).
- `notch.rs`/`notch.ts` in Folio sprechen schon `/activity`, `/events` und `/shelf`.

## Was fehlt (nicht verhandelbar)

- **Drehen und Zuschneiden dauerhaft speichern:** `pagesRotation` ist bei PDF.js nur Ansicht, und `extractPages` dreht nicht.
- **Komprimieren, Schwarzweiß, OCR-Textebene einbetten, Flatten:** PDF.js schreibt keine Bild- oder Inhaltsströme um.
- → Ein Rust-Modul `pdfops.rs` auf Basis von **lopdf (MIT)** deckt das alles ab. Kein Ghostscript (AGPL), kein MuPDF (AGPL, steht auch im README).

## Phasen

Jede Phase endet wie bisher mit einem prüfbaren Folio-Test-Update.

### 0.9 Seitenleiste und Ansichten
- Seitenleiste links: nur die Miniaturen mit leichtem Schatten, sonst nichts. Einblenden per Wisch vom linken Rand (Trackpad-`deltaX` bzw. Touch), per Hover am Rand oder per Taste. Ausblenden per Wisch oder Ziehen nach links.
- Miniaturen werden faul gerendert (IntersectionObserver, kleiner Maßstab, LRU-Cache pro Fingerprint) und folgen der Invertierung.
- Kontaktbogen: Vollflächen-Raster mit denselben Miniaturen.
- Ansichtsmodi: Einzelseite, Doppelseite, fortlaufend. **Achtung:** Autoscroll-Leiste, Seitenchip und Doppelklick-Zoom gehen von vertikalem Scrollen aus. Seitenweises und horizontales Scrollen müssen dort extra geprüft werden.
- Eigene Lesezeichen pro Dokument, gespeichert nach `doc.fingerprints[0]` statt nach Pfad (übersteht Umbenennen). Als eigener Reiter im Kapitelpanel.

### 0.10 Seiten bearbeiten
- Seiten in der Leiste ziehen = umsortieren. Entf = löschen. Drehen per Kontextmenü. PDF auf die Leiste ziehen = an der Drop-Stelle einfügen. Mehrere PDFs auf die Bibliothek ziehen = zusammenführen.
- Modell: Seitenkarte `[{quelle, seite, drehung, crop}]`. Jede Operation baut sie über `extractPages` neu auf, lädt das Ergebnis neu und stellt die Scrollposition wieder her. **Undo/Redo** ist ein Stapel von Seitenkarten, nicht von Byte-Kopien (bei einem 27-MB-PDF wichtig).
- Seiten herausziehen: Zuerst wird eine temporäre PDF geschrieben, dann startet ein nativer Drag. WebView2 kann Dateien nicht von sich aus aus dem Fenster ziehen, das geht nur über das `drag`-Crate bzw. `tauri-plugin-drag` (MIT/Apache). Ablegen im Explorer = Datei. Ablegen in der Bibliothek = neues Dokument im Bibliotheksordner (siehe Frage 3).
- Drehen und Zuschneiden werden beim Sichern über `pdfops.rs` geschrieben (`/Rotate`, `/CropBox`).
- Gesichert wird über den vorhandenen Pfad mit `ReplaceFileW`, Undo bleibt bis dahin möglich.

### 0.11 Text aus Bildern (das „Live Text“ von Windows)
- Seiten ohne Text (`getTextContent` leer) laufen durch **Windows.Media.Ocr** (`windows`-Crate, Features `Media_Ocr`, `Graphics_Imaging`). Das läuft offline. Welche Sprachen gehen, hängt von den installierten Windows-Sprachpaketen ab.
- Die Wörter mit ihren Rahmen werden zu einer eigenen Ebene im Stil von `textLayer`. Damit funktionieren Auswählen, Kopieren und die vorhandene Suche.
- Datendetektoren: Regex für URL, E-Mail und Telefonnummer. Alles wird klickbar und über `plugin-opener` geöffnet (`mailto:`, `tel:` → Smartphone-Link).
- Kontextmenü der Auswahl: Nachschlagen, Übersetzen, Im Web suchen (öffnet die URL im Standardbrowser). Ein „Nachschlagen“ auf Systemebene wie bei macOS gibt es unter Windows nicht.
- Beim Sichern optional die OCR-Textebene unsichtbar einbetten (Textmodus 3, Helvetica mit WinAnsi, deckt Umlaute ab). Die Option erscheint nur, wenn das Dokument keinen eigenen Text hat.
- Inhaltsverzeichnis automatisch erkennen: Heuristik aus `getTextContent` (Schriftgröße aus `transform`, Nummerierung „2.1“, kurze Zeilen) plus Parser für gedruckte Inhaltsseiten („Titel …… 14“), abgeglichen mit den Seitenbezeichnungen. Das Ergebnis erscheint im vorhandenen Kapitelpanel als „erkannt“ und lässt sich korrigieren.

### 0.12 Unterschrift übers Handy
- In Folio: „Unterschreiben“ → QR-Code. Am Handy öffnet sich eine Zeichenseite (Canvas, Pointer Events). Die Unterschrift kommt als SVG zurück und wird als Signatur-Editor am Cursor oder in ein Unterschriftsfeld des Formulars gesetzt. Einmal gespeicherte Unterschriften lassen sich wiederverwenden.
- Server: **den vorhandenen Server der Notch (`share.rs`) wiederverwenden** oder **einen eigenen in Folio bauen**? Siehe Frage 1.
- Löcher, die wir abdecken müssen: Gast-WLAN mit Client-Isolation (dann hilft nur Zeichnen mit Maus oder Stift als Rückfall), Firewall-Abfrage, abgelaufener Schlüssel.
- Rechtlich ist das eine einfache elektronische Signatur nach eIDAS, keine qualifizierte. Für die meisten Formulare reicht das.

### 0.13 Komprimieren und Schwarzweiß (Notch und Folio)
- `pdfops.rs`:
  - Bild-XObjects auf Ziel-DPI herunterrechnen und als JPEG neu kodieren. Voreinstellungen: Bildschirm 100, E-Mail 150, Druck 220.
  - Objekt-Streams komprimieren, Unbenutztes entfernen.
  - Bei Scans spart das viel, bei reinen Text-PDFs wenig. Das zeigen wir ehrlich als Vorher/Nachher an.
- Schwarzweiß:
  - Bilder auf Luminanz umrechnen.
  - Farboperatoren im Inhaltsstrom auf Grau umschreiben (`rg`/`RG`/`k`/`K` → `g`/`G`).
  - Schattierungen und Muster mit eigenen Farbräumen sind das Risiko. Version 1 meldet solche Seiten, statt sie stillschweigend falsch umzuwandeln.
- Ergebnis landet neben dem Original und wird nie überschrieben (dieselbe Regel wie in der Notch).
- Notch: „Komprimieren“ und „Schwarzweiß“ als zwei getrennte Ziele unter „Umwandeln in …“ für PDFs. Den Fortschritt zeigt eine Activity, das Ergebnis landet über `/shelf` in der Ablage.

### Später: Text ersetzen
- Echtes Umfließen von Text geht nicht. Ein PDF enthält positionierte Glyphen, keinen Fließtext. Das können nur kommerzielle SDKs oder MuPDF (AGPL).
- Machbar: Textstelle wählen → weiß abdecken → neues Textfeld mit möglichst passender Schrift darüber → beim Sichern über `pdfops.rs` **flatten**, damit niemand die Abdeckung wegziehen kann. Für Tippfehler und Daten reicht das, für Absätze nicht.

## Vorschläge, die zum Projekt passen (noch nicht beschlossen)

1. **Drucken.** Das fehlt Folio komplett.
2. **PDFs mit Passwort öffnen.** `onPassword` wird bisher nicht behandelt.
3. **Flatten vor dem Weitergeben.** Sonst lässt sich eine eingesetzte Unterschrift einfach verschieben.
4. **Bilder oder Screenshot zu PDF:** Bilder auf Folio ziehen oder aus der Zwischenablage der Notch einfügen. Geht über `extractPages` mit `image`.
5. **An iPhone senden:** den vorhandenen QR-Austausch der Notch direkt aus Folio aufrufen.
6. **Echtes Schwärzen:** Inhalt entfernen, nicht nur einen schwarzen Kasten darüberlegen. Aufwendig, deshalb zuletzt.
7. **Konflikt erkennen, wenn ein anderes Programm die Datei geändert hat.** Ist in den Notizen zu 0.7.0 schon als Lücke vermerkt.
8. Explorer-Kontextmenü „Mit Folio komprimieren / zusammenführen“. Unter Windows 11 landet das ohne Paketierung nur unter „Weitere Optionen“.

## Gestrichen bzw. infrage gestellt

- **Einzelbilder eines animierten GIFs:** Folio öffnet keine Bilder. Das ist eine Vorschau-Funktion von macOS, kein PDF-Feature. Vorschlag: streichen. Höchstens „Bilder → PDF“ (Vorschlag 4).

## Offene Fragen

1. Unterschrift: Unterschreibst nur du selbst mit deinem Handy, oder auch Dritte? Server in der Notch wiederverwenden oder unabhängig in Folio?
2. Komprimieren und Schwarzweiß: Rechnet `folio.exe --compress <pdf>` als Kommandozeile, die die Notch wie ffmpeg aufruft? Oder ein gemeinsames Rust-Crate, das beide Apps einbinden?
3. Bibliothek: Wohin speichern wir neue Dokumente (extrahierte Seiten, Zusammengeführtes)? Vorschlag: `Dokumente\Folio`.
4. Seitenleiste: Bedienst du Folio mit Touchpad, Maus oder Touchscreen? Davon hängt ab, welche Wischgeste wir bauen.
5. Ist `main` auf GitHub (0.8.4) der aktuelle Stand, oder liegt in `D:\Dev\folio` Neueres?
