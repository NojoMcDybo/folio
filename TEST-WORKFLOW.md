# Folio Test

Aktuelle Version: **0.3.0** installiert. Phase 1 umfasst Hover-Seitenzahl, Doppelklick auf freie Seitenflaeche (Seitenbreite/vorheriger Zoom) und eine gemeinsame weniger gesaettigte Invertierung. Frontend-/Release-Build und erweiterte Browserpruefung erfolgreich. Installierte Datei entspricht dem Build mit erwartetem NSIS-Marker; Desktop-Ziel sowie Original-App/Verknuepfung/PDF-Zuordnung geprueft. Native Bedienpruefung dieser neuen Funktionen steht beim Benutzer aus. Installer-SHA256: `6CB0224E32327919658ED9C414D768EEE336B2EFF6ECA6BB3D091386B04AAB16`.

Vorheriges Update: **0.2.1** mit helleren weissen Scrollleisten installiert. Frontend-/Release-Build und Browserpruefung einschliesslich Hover-Aufklappen erfolgreich; beide Groessen visuell geprueft. Installierte Datei gegen Build und Desktop-Ziel geprueft, Original-App/Verknuepfung/PDF-Zuordnung unveraendert. Installer-SHA256: `07BE9E2A6BD52DFAECEE702CE4142D349DFFAC58D6E410E754514A6DEB1C4407`.

Diese Arbeitskopie prueft den Weg von einer kleinen Aenderung zur installierten Windows-App.

## Ausgangsstand

- Original: `D:\Dev\folio`, Zweig `main`, Commit `1daad98a3523d0775f5e6bdb41b94cb4015777c2`.
- Sicherung: `D:\Dev\folio-backups\2026-09-07-before-test` mit vollstaendigem Git-Bundle, Planungsnotizen und bisherigem Installer 0.1.0. Das Installer-Datum ist aelter als der aktuelle Quellstand; er wird als bisheriges Installationspaket aufbewahrt, nicht als nachgewiesener Build dieses Commits.
- Entwicklung: `D:\Dev\folio-test`, Zweig `codex/apple-ui`. Der erste Versuch ist als Commit `2838df9` gesichert.

## Getrennte Testinstallation

`npm run testapp:build` baut mit `src-tauri/tauri.test.conf.json`:

- App/Verknuepfung: **Folio Test**
- Datei: `folio-test.exe`
- Kennung und eigener WebView-Datenspeicher: `de.nojo.folio.test`
- Getesteter Installationsort: `D:\Dev\folio-test-installed` (Installer-Argument `/D=D:\Dev\folio-test-installed`). Dieser feste Pfad vermeidet die beobachtete Umleitung von AppData-Schreibzugriffen in den Datenordner der Codex-Desktop-App.
- Keine Registrierung als PDF-Dateityp.

Die regulaere Konfiguration fuer Folio bleibt erhalten. Fuer Test-Builds immer den obigen Befehl verwenden.

## Erste Aenderung

Die Lupe zeigt einen Kreis mit 160 statt 96 CSS-Pixeln Durchmesser. Der Glasrand bleibt 17 Pixel breit, die Vergroesserung bleibt bei 2,5x. Zeichenflaeche und Layout beziehen die Groesse aus derselben Konstante. Der aeussere Radius wird als Pixelradius angegeben, damit auch der WebGL-Renderer die groessere Lupe kreisrund zeichnet.

## Manuell pruefen

1. Folio Test ueber die Desktop-Verknuepfung starten.
2. Eine Test-PDF oeffnen, scrollen und mit Strg+Rad zoomen.
3. Den Suchknopf ueber die Seite ziehen: groessere Lupe, unveraenderte Vergroesserung.
4. Invertierung einschalten und die Lupe erneut pruefen.
5. Fenster schliessen und erneut starten; die Bibliothek sollte das Testdokument behalten.

Nur Testdokumente bearbeiten: Die App besitzt weiterhin die vorhandene Speicherfunktion fuer die geoeffnete Datei. Der zuvor beobachtete Fehler im Speicherfehler-/Schliessen-Dialog ist nicht Bestandteil dieser Lupenaenderung.

## Spaeterer Update- und Repository-Schritt

Version 0.2.0 wurde als Update der Test-App installiert. Fuer weitere Updates Name, Dateiname und Kennung unveraendert lassen; danach Verknuepfung und gespeicherte Bibliothek pruefen. GitHub-Push und Uebernahme nach main folgen erst nach gemeinsamer Durchsicht.

## Rueckweg

Die Originalinstallation und `main` bleiben verfuegbar. Die Test-App kann separat ueber Windows deinstalliert werden. Die Sicherung enthaelt den bisherigen Installer; das Git-Bundle kann bei Bedarf in einen neuen Ordner geklont werden. Kein Zuruecksetzen des Originalordners ist fuer diesen Versuch erforderlich.

## Pruefstand am 2026-09-07

- Version 0.1.1 wurde vom Benutzer ausprobiert und als gut bewertet. Danach hat er die Fortsetzung in der Kopie und die Apple-UI-Arbeit beauftragt.
- Version **0.2.0** gebaut, als Update installiert und nativ gestartet. Desktop-Verknuepfung zeigt auf `D:\Dev\folio-test-installed\folio-test.exe`.
- Installer erstellt eigene Kennung und Verknuepfung ohne PDF-Dateizuordnung. Bestehende Folio-Verknuepfung und PDF-Standardprogramm vor/nach Installation identisch.
- Installierte Programmdatei gegen Build verglichen: identisch bis auf den von Tauri erwarteten dreistelligen NSIS-Bundlemarker.
- Bisherige Folio-Verknuepfung zeigt in den Claude-App-Datenordner; diese Installation wurde nicht ersetzt.
- Die Rundungskorrektur aus dem nicht installierten Zwischenbuild 0.1.2 ist in 0.2.0 enthalten.
- Frontend- und nativer Release-Build erfolgreich. Produktions-Browserpruefung mit echtem PDF.js/WebGL bei 100, 125 und 200 Prozent Skalierung erfolgreich: PDF, Suche, Werkzeuge, Lupe, Invertierung, Kontrast auf weisser Seite, F11 und kleines Fenster. Native Datei-/Fensteraufrufe sind in dieser Browserpruefung ersetzt.
- Native Sichtpruefung nach dem Update: neue Bibliothek dargestellt, vorhandene Eintraege weiterhin vorhanden. Weitere automatisierte Bedienung wurde nach erkannter Benutzereingabe beendet; native PDF-Bedienung ist fuer diese Version damit noch nicht vollstaendig geprueft.
- Original-Programmdatei und Original-Verknuepfung per SHA256 vor/nach Update identisch; PDF-Dateizuordnung unveraendert. Original-Quellstand bleibt `1daad98a3523d0775f5e6bdb41b94cb4015777c2` ohne Aenderungen an versionierten Dateien.
- Installer: `src-tauri/target/release/bundle/nsis/Folio Test_0.2.0_x64-setup.exe`, SHA256 `4C591630843364050DE4E0F17B55A56298CBED2055128776381ADF3D2DDFE00E`.
- Kein GitHub-Push und keine Uebernahme nach main erfolgt.
