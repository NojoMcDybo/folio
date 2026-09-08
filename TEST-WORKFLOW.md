# Folio Test

Neuester Stand: **0.7.0** installiert, Binaerdatei und Desktop-Verknuepfung verifiziert; Original-App, Verknuepfung und PDF-Zuordnung unveraendert. Bibliothekseintraege entfernen, bestaetigtes Verschieben in den Papierkorb und Speicherfehler absichern. Acht native Dateisicherheitstests sowie separat ausgefuehrter Papierkorb-Smoke-Test an einer eigenen Wegwerf-PDF bestanden. Browserpruefungen der Bibliotheks-/Speicherfehler, aktiven Texteingabe und vorhandenen Lesefunktionen bestanden. Ein gespeichertes Textfeld wurde in den exportierten PDF-Bytes nachgeprueft. Native Window-/Dialog-Aufrufe sind in Browserpruefungen ersetzt; native Dateioperationen wurden separat getestet. Release-Build und frisches unabhaengiges Review (ship, keine Befunde) bestanden. Aenderungen durch andere Programme am gleichen PDF werden noch nicht als Versionskonflikt erkannt; abruptes Beenden/Stromausfall liegt ausserhalb der geprueften Schliessablaeufe. Installer-SHA256: E890DA652C4B6E97ADCE8B2786A00EDC008BC171424C9F9AD75EE3E4C3BA8227.

Neuester Stand: **0.6.0** installiert und Binaerdatei/Desktop-Ziel verifiziert. Frisches unabhaengiges Review: ship, keine Befunde. Originalinstallation, Verknuepfung und PDF-Dateizuordnung unveraendert. Hoehere Glasaufloesung fuer Kapitelmenue/Suchleiste, Lupe nur ueber PDF-Seiten und fuenf speicherbare Stiftfarben. Frontend-/Release-Build bestanden. Neue Browserpruefung bei 100/200 Prozent Skalierung: Aufloesung, Lupengrenzen, Palette speichern/wechseln/neuladen, ungueltige Hex-Werte und Speicherdaten, reale PDF.js-Stiftfarbe, Escape/F11 und kleines Fenster bestanden. Vorhandene Kapitel-, Verschiebe-, UI- und Scrolltests ebenfalls bestanden. Native Farbdialog-Bedienung und Grafikleistung auf weiterer Hardware sind noch nicht geprueft. Installer-SHA256: `22771675C98A265E9E8DC24A0F9614DD2272E0ADD8015D4B6BFD3FA030A66ED3`.

Neuester Stand: **0.5.1** installiert. Kapitelmenue mit adaptiv abgedunkeltem Liquid Glass, verschiebbarem Oeffner und separat am Kopf verschiebbarem Panel; Positionen werden gespeichert. Dezente weisse Scrollleiste innerhalb des Menues. Positionsdrift beim Speichern gedrueckter Buttons behoben. Frontend-/Release-Build, Scrollnavigation, Kapitel- und bestehende UI-Pruefungen bestanden; Glas auf gemischtem/hellem Hintergrund und im kleinen Fenster visuell geprueft. Frisches unabhaengiges Read-only-Review: `ship`, keine Befunde. Installation/Binaerdatei/Desktop-Ziel verifiziert; Original-App, Verknuepfung und PDF-Zuordnung unveraendert. Native Bedienpruefung und besondere GPU-/DPI-Konfigurationen stehen noch aus. Installer-SHA256: `72D2979C59ACE4BA402E447F6DAA67287FF9130155E81935B88E46BD2CF38FD4`. Astra Advisor ist als weiterer Projektworkflow in CLAUDE.md hinterlegt.

Neuester Stand: **0.5.0** installiert. Scrollkurve startet ohne festen Mindestwert direkt ausserhalb der Ruhezone bei null. Kapitelpanel fuer vorhandene PDF-Lesezeichen inklusive Unterkapiteln, benannten Zielen und Seitenbezeichnungen. Frontend-/Release-Build, Scrollkurven-/Navigationspruefungen, Kapitelpruefungen mit echten PDF-Fixtures sowie bestehende UI-Pruefung bestanden. Installation/Binaerdatei/Desktop-Ziel verifiziert; Original-App und Verknuepfung unveraendert. Die native Bedienpruefung der neuen Funktionen steht beim Benutzer aus. Installer-SHA256: `8CC93F0CA92B2E229C8253DA6C1E113983AE8B01A706F26A8A012DCD113CAECC`.

Neuester Stand: **0.4.0** installiert, mit Zielseitenanzeige, Klicksprung/Pause und stufenlosem Autoscroll. Frontend-/Release-Build, `npm run test:scroll` und Browserpruefungen bestanden (3/60 Seiten, unterschiedliche Hoehen, kleines Fenster, beide Ziehgesten, Stoppen/Fokus/F11 und bestehende UI). Installierte Datei, Desktop-Ziel und unveraendertes Original verifiziert; native Bedienpruefung der neuen Navigation steht beim Benutzer aus. Installer-SHA256: `B633EB9AE637961421F40052A7ACD7519681345E8A03E62DF889029DD5D7AACD`.

Aktuell installiert: **0.3.2** mit staerkerer Lichtbrechung in der grossen Autoscroll-Leiste. Build und Browserpruefung erfolgreich; Installation/Binaerdatei/Desktop-Verknuepfung verifiziert, Original unveraendert. Installer-SHA256: `A6666536A8B561B7FF549B578EF20608318D0A3BC9805795F384BFF9C481EAD9`.

Neuestes Update: **0.3.1** installiert, mit adaptivem Scrollleistenkontrast und reinweisser Fortschrittsfuellung. Frontend-/Release-Build sowie Browserpruefung und Sichtpruefung beider Groessen auf hellen/dunklen Flaechen erfolgreich. Installierte Datei und Desktop-Ziel verifiziert; Original-App, Original-Verknuepfung und PDF-Dateizuordnung unveraendert. Installer-SHA256: `0BC3F2F65F8A25052C606D961E2E0F33FFDD2602962311149ABC5F8F8FA81BC8`.

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
