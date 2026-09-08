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

### Lesewerkzeuge 0.6.0

- Bei geoeffnetem Kapitelmenue oder Suchfeld werden Glas und Hintergrund mit bis zu 3 Pixeln pro CSS-Pixel gezeichnet (zuvor bei 100 Prozent Skalierung 1,5). Die gemeinsame Glasflaeche nutzt die hoehere Aufloesung nur solange eines dieser Panels sichtbar ist; Hardware-Groessenlimits bleiben wirksam. Kapitel-Canvas uebernimmt die volle Aufloesung. Der Panel-Blur verwendet 25 gewichtete Samples mit von der Aufloesung unabhaengigem Abstand.
- Lupe aktiviert sich erst nach Ziehbeginn und nur mit Zeiger auf einer gerenderten PDF-Seitenflaeche innerhalb des sichtbaren Lesebereichs. Hintergrund und Seitenzwischenraeume aktivieren sie nicht. Scrollen/Fenstergroesse pruefen die Position erneut; Loslassen, Abbruch und Fokusverlust blenden sie aus.
- Stiftfarben: fuenf direkt waehlbare Plaetze fuer Marker, Stift und Text. Farbfeld oder Hex-Eingabe bearbeitet den gewaehlten Platz; explizites Speichern uebernimmt die Farbe. Palette und Auswahl bleiben unter `folio.pen-colors` erhalten. Beim Schreiben werden andere Plaetze aus dem neuesten Speicherstand uebernommen. Ungueltige Daten werden abgefangen, Speicherfehler sichtbar gemeldet.
- Eigenes kompaktes Farbpanel am Farbknopf, innerhalb des Fensters begrenzt. Escape schliesst nur die Farbwahl; aktive Stifte bleiben aktiv. Klick ausserhalb, Schliessen der Werkzeuge und F11 schliessen das Panel.

- Lichtbrechung vorwiegend am Rand, auf wenige Pixel begrenzt. Keine RGB-Aufspaltung und keine adaptive Abdunklung der Glasflaeche.
- Pixelabdeckung aus der Distanzfunktion mit Ableitungen; Zeichenrechteck geht ueber die Kontur hinaus. So wird die aeussere Kantenglaettung nicht abgeschnitten.
- Die Aufloesung folgt der Bildschirmskalierung und den GPU-Grenzen. Der bisherige pauschale vierfache Vollbild-Renderpuffer und die Symboltexturen entfallen.
- Symbole bleiben DOM-Vektoren. Eine kleine Helligkeitskarte des Dokumenthintergrunds steuert helle/dunkle Symbolfarben, mit Hysterese gegen Flackern an Seitenraendern.
- Suchleiste nutzt etwas mehr Streuung. Der Speicherdialog hat einen eigenen lesbaren Standardhintergrund.
- CSS-Ersatzdarstellung bei fehlendem/verlorenem WebGL-Kontext; Kontextwiederherstellung baut die Ressourcen neu auf. Einstellungen fuer reduzierte Transparenz und Windows-Kontrastmodus werden beruecksichtigt.

## Bedienelemente

### Kapitelglas 0.5.1

- Kapitelmenue nutzt den bestehenden WebGL-Glasrenderer mit Lichtbrechung und Streuung. Helle Bereiche werden lokal sowie anhand der bestehenden Helligkeitserkennung abgedunkelt; helle Texte bleiben auch ueber gemischtem Papier/Hintergrund lesbar.
- Die Glasflaeche wird zusaetzlich innerhalb der Menueebene gezeichnet, sodass andere schwebende Knoepfe nicht ueber Kapiteltext erscheinen. CSS-Ersatz bei fehlendem WebGL und reduzierter Transparenz.
- Kapitelknopf ist frei verschiebbar. Das Menue laesst sich an der Kopfzeile verschieben; Liste und Schliessknopf loesen kein Ziehen aus. Beide Positionen werden mit dem vorhandenen System gespeichert. Ohne eigene Menueposition oeffnet es in der Naehe des Knopfs; Vergroessern des Inhalts und Fensteraenderungen halten es erreichbar.
- Scrollbereich liegt unterhalb der festen Kopfzeile. Runde weisse Innenleiste mit vier Pixeln sichtbarer Breite und schwachem Schein; sie scrollt nur die Kapitelliste.
- Gemeinsame Positionsspeicherung korrigiert: speichert Layoutkoordinaten ohne temporaere Druckanimation. Pruefungen von Positionserhalt, Neustart, kleinem Fenster, hellem/gemischtem Hintergrund, internem Scrollen und bestehender Kapitel-/UI-Bedienung bestanden.

### Kapitelzugriff und Scrollkorrektur 0.5.0

- Inhaltsverzeichnis-Knopf links neben den Lesebedienelementen. Lesbares dunkles Panel mit verschachtelten Listen, separaten Aufklappknoepfen und Seitenbezeichnungen. Unterkapitel starten eingeklappt; aktives Kapitel wird anhand der Leseseite hervorgehoben.
- Unterstuetzt direkte sowie benannte PDF-Ziele und Seitenreferenzen. Der PDF-Zielpunkt wird verwendet, die aktuelle Zoomstufe bleibt erhalten. Externe Lesezeichen werden nicht als Kapitel geoeffnet; fehlende Ziele bleiben deaktiviert.
- Metadaten werden erst beim Oeffnen geladen, Zielaufloesung mit maximal vier parallelen Auftraegen. Veraltete Ergebnisse nach Dokumentwechsel sowie ueberholte schnelle Klicks werden verworfen. Lesezeichentitel werden ausschliesslich als Text eingefuegt.
- Escape und Schliessknopf geben Fokus an den Oeffner zurueck; F11 schliesst das Panel. Auf kleinen Fenstern schliesst es nach Auswahl eines Kapitels. PDFs ohne Gliederung erhalten einen Hinweis; gedruckte Inhaltsseiten werden nicht automatisch interpretiert.
- Scrollgeschwindigkeit startet ausserhalb der mittleren Ruhezone bei null. Die verbleibende Strecke bis zum Rand wird auf 0..1 normiert, quadratisch auf maximal 1600 Pixel/Sekunde abgebildet. Der bisherige feste Startwert 20 entfaellt; Grenzwerte und Viertelgeschwindigkeit auf halber Strecke sind getestet.
- Pruefung: echte PDF mit Hierarchie, benannten Zielen, roemischen/arabischen Seitenbezeichnungen, ungueltigem und externem Ziel sowie HTML-aehnlichem Titel. Kapitelziele, Zoomerhalt, Tastaturbedienung, kleines Fenster und leere Gliederung bestanden; bisherige Scroll-/UI-Pruefungen ebenfalls erfolgreich.

### Scrollnavigation 0.4.0

- Die grosse Leiste zeigt `Seite N` links neben dem Cursor, ohne Vorschaubild. Gleiche Zielbereiche pro physischer PDF-Seite; erste und letzte Seite sind enthalten, unabhaengig von der aktuellen Scrollposition oder unterschiedlichen Seitenhoehen.
- Hover steuert weiter Autoscroll. Klick springt zur angezeigten Seite und stoppt bis zur naechsten Mausbewegung. Ziehen der grossen Leiste folgt den Zielseiten kontinuierlich, ohne zum schmalen Griff zusammenzuklappen. Der schmale Griff behaelt die direkte Positionssteuerung.
- Mittlere 16 Prozent sind Ruhezone, gekennzeichnet durch einen feinen Mittelstrich. Ausserhalb quadratische Geschwindigkeitskurve von sehr langsam bis maximal 1600 Pixel/Sekunde je Richtung. Beschleunigung wird zeitbasiert geglaettet; Ruhezone, Pointerleave, F11, Fokusverlust und ausgeblendetes Fenster stoppen sofort. Nach Verlassen bleibt die breite Form eine Sekunde sichtbar.
- Tooltip bleibt innerhalb des Fensters, blockiert keine Mausinteraktion und verwendet den vorhandenen adaptiven Glaskontrast.
- Pruefung: automatisierte Kurven-/Seitenbereichstests (`npm run test:scroll`, aktueller Node mit TypeScript-Stripping); Browser mit echter 60-Seiten-PDF inklusive unterschiedlicher Hoehen sowie 3-Seiten-PDF im 520x400-Fenster. Seite 13, erste/letzte Seite, Klickpause, Wiederaufnahme, Mitte, Richtungswechsel, Verlassen, beide Ziehgesten, F11 und Fokusverlust bestanden. Bestehende UI-Pruefung separat ausgefuehrt.

Version 0.3.2: Staerkere Lichtbrechung ausschliesslich beim Aufklappen der Autoscroll-Leiste. Brechungsweg von 3,5 auf 11 CSS-Pixel, breiterer optischer Rand; Staerke folgt kontinuierlich der aktuellen Leistenbreite. Die Fortschrittsmitte bleibt weiss, ihr Rand laesst die Brechung durchscheinen. Browser-Sichtpruefung ueber PDF-Text und Seitenraendern sowie bestehende UI-Pruefungen erfolgreich.

Version 0.3.1: Fortschritt in beiden Scrollleistengroessen ist rein weiss. Auf hellem Hintergrund ergaenzt die Helligkeitserkennung dunkle Kontur und Schatten; die ungefuellte Restflaeche wird dezent grau. Hysterese und weiche Uebergaenge stabilisieren den Wechsel. Beide Groessen auf weissem und dunklem Hintergrund im Browser visuell geprueft; WebGL und vorhandene UI-Pruefungen ohne Fehler.

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

Bibliotheks-/Dateiloeschung und Absicherung des bestehenden Speicherfehlers sind weiterhin offen. Kapitelzugriff wurde in 0.5.0 ergaenzt. Der violette UI-Akzent wurde durch Blau ersetzt.

## Pruefung

Frontend-Build sowie Browserpruefung der produktiven Build-Dateien mit Edge/Chromium bei 100, 125 und 200 Prozent Skalierung. Echter PDF.js-Renderer und echte WebGL-Shader; Dateizugriff und Fensteraufrufe sind in dieser Browserpruefung ueber die offiziellen Tauri-Mocks ersetzt. Geprueft: Bibliothek, PDF-Darstellung, Suche, Werkzeuge, Lupe beim Ziehen, Invertierung, Symbolkontrast auf weisser Seite, F11 und Fenster bis 520 x 400. Native Version 0.2.0 als Update installiert, gestartet und Bibliothek gesichtet; vorhandene Eintraege weiterhin da. Weitere native Bedienung nach erkannter Benutzereingabe beendet.
