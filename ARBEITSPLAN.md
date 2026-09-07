# Folio: naechste Schritte

Der Benutzer hat die neue Apple-inspirierte Oberflaeche positiv bewertet. Sie bleibt die gestalterische Grundlage. Entwicklung und Testinstallation erfolgen ausschliesslich in der Kopie; der Claude-Stand bleibt erhalten. Jede Phase endet mit einem pruefbaren Folio-Test-Update. GitHub-Push und Uebernahme nach main folgen nach gemeinsamer Durchsicht.

## 1. Kleine Verbesserungen beim Lesen

- Beide Scrollleisten neutral weisser und heller leuchten lassen (Version 0.2.1).
- Seitenzahl unten links bei Hover wieder zeigen und sichtbar halten.
- Violettstich invertierter Dokumente anhand einer Farb-/Graustufen-Testseite korrigieren; PDF, Lupe und Glas muessen dieselbe Farbumwandlung verwenden.
- Doppelklick zum Vergroessern im bestehenden Fenster. Vorschlag: zwischen Seitenbreite und vorheriger Zoomstufe wechseln. Textauswahl darf dabei nicht unbeabsichtigt ausgeloest oder verhindert werden; Geste vor Umsetzung festlegen.

## 2. Scrollnavigation zusammen ueberarbeiten

- Zielseitenzahl neben dem Mauszeiger an der grossen Leiste zeigen, ohne Vorschaubild; Position oben entspricht fruehen Seiten.
- Automatisches Scrollen feiner abstufen, mit gut treffbarer Ruhezone in der Mitte. Mehr Geschwindigkeitsstufen gegen eine kontinuierliche Kurve im Test vergleichen.
- Vor Umsetzung festlegen, wie Zielseitenwahl und bestehendes Hover-Autoscrollen zusammenarbeiten. Vorschlag: Hover zeigt die Zielseite, Klick springt; das darf die bestehende Autoscroll-Funktion nicht stillschweigend ersetzen.
- Mit kurzen und langen PDFs pruefen: erste/letzte Seite, Richtungswechsel, Stoppen, Ziehen und verschiedene Fenstergroessen.

## 3. Kapitelzugriff

- Zuerst vorhandene PDF-Lesezeichen/Gliederung als aufklappbares Inhaltsverzeichnis nutzen.
- Verschachtelte Kapitel und gedruckte Seitenbezeichnungen beruecksichtigen.
- PDFs ohne strukturierte Kapitel weiterhin normal anzeigen. Das Erkennen eines nur gedruckten Inhaltsverzeichnisses ist ein spaeterer eigener Ausbau.

## 4. Bibliothek und verlaessliches Speichern

- Bestehenden Fehler beheben: Nach fehlgeschlagenem Speichern darf Schliessen keine ungesicherten Aenderungen verwerfen.
- Zwei getrennte Aktionen anbieten: aus Bibliothek entfernen und PDF-Datei vom Computer loeschen.
- Vorschlag fuer Dateiloeschung: Windows-Papierkorb, mit eindeutigem Dateinamen und Bestaetigung. Erst an Wegwerf-Testdateien pruefen.
- Fehlende Dateien, Schreibschutz und abgebrochenes Speichern/Loeschen behandeln; Bibliothek nur nach erfolgreicher Dateiaktion aktualisieren.

## Bereits erledigt

Groessere Lupe; neue klare Glasdarstellung mit geglaetteten Raendern; neutraler dunkler Lesehintergrund; unterscheidbare Marker-/Stift-Symbole; allgemeiner Werkzeugmenue-Knopf; separate Installation samt Desktop-Verknuepfung und geprueftem Updateweg.
