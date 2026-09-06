# Folio Test

Diese Arbeitskopie prueft den Weg von einer kleinen Aenderung zur installierten Windows-App.

## Ausgangsstand

- Original: `D:\Dev\folio`, Zweig `main`, Commit `1daad98a3523d0775f5e6bdb41b94cb4015777c2`.
- Sicherung: `D:\Dev\folio-backups\2026-09-07-before-test` mit vollstaendigem Git-Bundle, Planungsnotizen und bisherigem Installer 0.1.0. Das Installer-Datum ist aelter als der aktuelle Quellstand; er wird als bisheriges Installationspaket aufbewahrt, nicht als nachgewiesener Build dieses Commits.
- Entwicklung: `D:\Dev\folio-test`, Zweig `codex/folio-test-larger-lens`.

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

Nach gemeinsamer Sichtpruefung Testversion in der Test-Konfiguration erhoehen und erneut installieren. Name, Dateiname und Kennung unveraendert lassen; danach Verknuepfung und gespeicherte Bibliothek pruefen. GitHub-Push und Uebernahme nach main folgen erst nach gemeinsamer Durchsicht.

## Rueckweg

Die Originalinstallation und `main` bleiben verfuegbar. Die Test-App kann separat ueber Windows deinstalliert werden. Die Sicherung enthaelt den bisherigen Installer; das Git-Bundle kann bei Bedarf in einen neuen Ordner geklont werden. Kein Zuruecksetzen des Originalordners ist fuer diesen Versuch erforderlich.

## Pruefstand am 2026-09-07

- Version 0.1.1 gebaut, installiert und gestartet. Desktop-Verknuepfung zeigt auf `D:\Dev\folio-test-installed\folio-test.exe`.
- Installer erstellt eigene Kennung und Verknuepfung ohne PDF-Dateizuordnung. Bestehende Folio-Verknuepfung und PDF-Standardprogramm vor/nach Installation identisch.
- Installierte Programmdatei gegen Build verglichen: identisch bis auf den von Tauri erwarteten dreistelligen NSIS-Bundlemarker.
- Bisherige Folio-Verknuepfung zeigt in den Claude-App-Datenordner; diese Installation wurde nicht ersetzt.
- Benutzer prueft die App gerade selbst. Keine weiteren automatisierten Eingaben oder Installation waehrend dieses Tests.
- Version 0.1.2 mit Korrektur des bei der Sichtpruefung erkannten eckigen aeusseren Lupenrands ist erfolgreich gebaut; Installer liegt unter `src-tauri/target/release/bundle/nsis/Folio Test_0.1.2_x64-setup.exe`. Diese Version ist noch nicht installiert oder visuell geprueft. Installation als Update erfolgt erst nach dem laufenden Benutzertest.
- Oeffnen/Scrollen/Suche und die Lupe mit der erzeugten Test-PDF wurden noch nicht vollstaendig automatisiert geprueft. Build und App-Start sind geprueft; manuelle Bedienpruefung laeuft beim Benutzer.
- Kein GitHub-Push und keine Uebernahme nach main erfolgt.
