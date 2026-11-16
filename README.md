# Unihockey Trainingsplaner (Web-App)

Trainings nach den Rahmentrainingsplänen (RTP) von swiss unihockey planen – mit Goalie-Spur,
Hallenmodus, Saisonplanung und Teilen per Link/QR/Datei. Kein Login, kein Server: alle Daten
liegen lokal im Browser des jeweiligen Geräts.

## Ordner

- `app/` – die fertige App (statische Dateien). **Nur dieser Ordner wird veröffentlicht.**
- `tools/build-rtp.js` – liest die `Rahmentrainingsplaene_*.xlsx` in diesem Ordner und erzeugt `app/data-rtp.js`.
  Nach einem RTP-Update: neue Excel-Datei hier ablegen und `node tools/build-rtp.js` ausführen.
- `tools/serve.js` – lokaler Testserver: `node tools/serve.js` → http://localhost:5173
- `app/data-goalie.js` – Goalie-Übungen und Goalie-Ausbildung pro Stufe (eigene Ergänzung, frei editierbar).

## Aufs Handy bringen (gratis, ohne eigenen Server)

Die App liegt auf GitHub Pages: **https://samuel-int.github.io/unihockey-trainingsplaner/**

Online gestellt wird mit `sh tools/publish.sh`: Das Skript lädt den Quellcode auf den Branch `main`
und den Inhalt von `app/` auf den Branch `gh-pages`, den GitHub Pages ausliefert.
Die Excel- und PDF-Quelldateien bleiben lokal (`.gitignore`).

Für Änderungen an der App gibt es den Claude-Code-Agenten `trainingsplaner-wartung`
(`.claude/agents/trainingsplaner-wartung.md`).

Die Adresse auf dem Handy öffnen:
- Android (Chrome): Menü ⋮ → «App installieren»
- iPhone (Safari): Teilen → «Zum Home-Bildschirm»

Andere Trainer*innen bekommen einfach dieselbe Adresse. Trainings teilt man in der App über «Teilen».

## Hinweis zu den Inhalten

Schwerpunkte, Ausbildungsziele und Namen der Trainingsformen stammen aus den RTP von swiss unihockey.
Die Übungstexte (Beschreibung, Keypoints, Coachingfragen, Rad der Variation) stammen aus dem
Unihockey-Trainingsplaner (UTP) von swiss unihockey: **© swiss unihockey, Verwendung mit Einverständnis,
nur nicht-kommerziell** (die App darf nicht monetarisiert werden). Sie stehen in `app/data-utp.js`, erzeugt mit
`node tools/build-utp.js` (holt jede in den RTP verlinkte Übung einmal, ca. 300 ms Pause, Zwischenstand in
`tools/.utp-cache.json`; speichert keine Bilder, Videos oder Personendaten). Skizzen und Videos gibt es im UTP (Link in der App).

## Dokumentation für Agenten

Aufbau, Datenmodell, Arbeitsablauf und Bedienung stehen in Samuels LLM Wiki
(`C:\Users\leimg\OneDrive\Sämi\LLM Wiki`, Seiten `wiki/verein/*trainingsplaner*.md`),
dort liegt unter `tools/trainingsplaner/` auch eine Kopie dieses Codes. Massgebend ist dieser Ordner.
