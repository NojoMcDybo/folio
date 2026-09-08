# Folio: naechste Schritte

Der Benutzer hat die neue Apple-inspirierte Oberflaeche positiv bewertet. Sie bleibt die gestalterische Grundlage. Entwicklung und Testinstallation erfolgen ausschliesslich in der Kopie; der Claude-Stand bleibt erhalten. Jede Phase endet mit einem pruefbaren Folio-Test-Update. GitHub-Push und Uebernahme nach main folgen nach gemeinsamer Durchsicht.

## 1. Kleine Verbesserungen beim Lesen

Umgesetzt in 0.3.0: Hover-Seitenzahl, gemeinsame weniger gesaettigte Invertierung und Doppelklick auf freie Seitenflaechen. Der Benutzer hat Seitenbreite mit Rueckkehr zum vorherigen Zoom bestaetigt; Doppelklick auf Text bleibt Wortauswahl. Die konkrete Farbwiedergabe kann anhand seiner Dokumente weiter abgestimmt werden.

- Beide Scrollleisten neutral weisser und heller leuchten lassen (Version 0.2.1).
- Seitenzahl unten links bei Hover wieder zeigen und sichtbar halten.
- Violettstich invertierter Dokumente anhand einer Farb-/Graustufen-Testseite korrigieren; PDF, Lupe und Glas muessen dieselbe Farbumwandlung verwenden.
- Doppelklick auf freie PDF-Flaeche wechselt zwischen Seitenbreite und vorheriger Zoomstufe. Text, interaktive PDF-Elemente und aktives Zeichen-/Markierungswerkzeug behalten ihre eigenen Gesten.

## 2. Scrollnavigation zusammen ueberarbeiten

Erste Testvariante in 0.4.0 umgesetzt: Hover zeigt die physische Zielseitenzahl und steuert weiterhin Autoscroll. Klick springt zur angezeigten Seite und pausiert bis zur naechsten Bewegung. Grosse Leiste bleibt beim Ziehen gross; kleine Leiste behaelt direktes Ziehen zur Scrollposition. Stufenlose Kurve statt fuenf Feldern, 16 Prozent Ruhezone, sanftes Beschleunigen und sofortiges Stoppen beim Verlassen. Bediengefuehl anschliessend mit dem Benutzer abstimmen.

- Zielseitenzahl neben dem Mauszeiger an der grossen Leiste zeigen, ohne Vorschaubild; Position oben entspricht fruehen Seiten.
- Automatisches Scrollen feiner abstufen, mit gut treffbarer Ruhezone in der Mitte. Mehr Geschwindigkeitsstufen gegen eine kontinuierliche Kurve im Test vergleichen.
- Erste Variante: Hover zeigt die Zielseite und steuert Autoscroll; Klick springt und pausiert. Die Funktion wurde als Testvorschlag umgesetzt, die optionale Rueckfrage zur bevorzugten Geste blieb bisher unbeantwortet.
- Mit kurzen und langen PDFs pruefen: erste/letzte Seite, Richtungswechsel, Stoppen, Ziehen und verschiedene Fenstergroessen.

## 3. Kapitelzugriff

Umgesetzt in 0.5.0: Knopf links oben oeffnet das Inhaltsverzeichnis aus vorhandenen PDF-Lesezeichen. Unterkapitel sind aufklappbar, gedruckte Seitenbezeichnungen werden angezeigt. Auswahl springt zum PDF-Ziel ohne Zoomwechsel. PDFs ohne Lesezeichen erhalten einen Hinweis; defekte und externe Ziele sind deaktiviert. Zusaetzlich beginnt die Scrollkurve jetzt am Rand der Ruhezone bei null, ohne bisherigen 20-Pixel/Sekunde-Sprung.

- Zuerst vorhandene PDF-Lesezeichen/Gliederung als aufklappbares Inhaltsverzeichnis nutzen.
- Verschachtelte Kapitel und gedruckte Seitenbezeichnungen beruecksichtigen.
- PDFs ohne strukturierte Kapitel weiterhin normal anzeigen. Das Erkennen eines nur gedruckten Inhaltsverzeichnisses ist ein spaeterer eigener Ausbau.

## 4. Bibliothek und verlaessliches Speichern

Umgesetzt fuer 0.7.0: getrennte Bibliotheks-/Papierkorbaktionen, Dateibestaetigung mit Pfad und Schutz geoeffneter PDFs. Speichererfolg wird erst nach bestaetigtem Schreiben angenommen; Schliessen und native Fensteraktionen teilen denselben Speicherdialog. Dateitests und Browserpruefungen bestanden; Installation und abschliessendes Review siehe TEST-WORKFLOW.md.

- Bestehenden Fehler beheben: Nach fehlgeschlagenem Speichern darf Schliessen keine ungesicherten Aenderungen verwerfen.
- Zwei getrennte Aktionen anbieten: aus Bibliothek entfernen und PDF-Datei vom Computer loeschen.
- Dateiloeschung auf Benutzerwunsch ueber Windows-Papierkorb, mit eindeutigem Dateinamen und Bestaetigung; an eigener Wegwerf-Testdatei erfolgreich geprueft.
- Fehlende Dateien, Schreibschutz und abgebrochenes Speichern/Loeschen behandeln; Bibliothek nur nach erfolgreicher Dateiaktion aktualisieren.

## Bereits erledigt

Groessere Lupe; neue klare Glasdarstellung mit geglaetteten Raendern; neutraler dunkler Lesehintergrund; unterscheidbare Marker-/Stift-Symbole; allgemeiner Werkzeugmenue-Knopf; separate Installation samt Desktop-Verknuepfung und geprueftem Updateweg.
