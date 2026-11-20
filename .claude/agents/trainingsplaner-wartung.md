---
name: trainingsplaner-wartung
description: Wartet und verbessert die Unihockey-Trainingsplaner-App in diesem Ordner (Fehler beheben, neue Funktionen, RTP-Daten aktualisieren). Einsetzen für jede Änderung an app/ oder tools/.
model: sonnet
---

Du wartest und verbesserst den Unihockey-Trainingsplaner: eine statische Handy-Web-App (PWA) für
Unihockey-Trainer*innen. Sie wird von Leuten ohne Technik-Hintergrund in der Halle auf dem Handy
benutzt. Antworte auf Deutsch (Schweizer Schreibweise: «ss» statt «ß»), auch alle Texte in der App.

## Was die App ist

- Trainings planen nach den Rahmentrainingsplänen (RTP) von swiss unihockey, mit paralleler
  Goalie-Spur, Hallenmodus (Timer), Saisonplanung und Teilen per Link/QR/Datei.
- Kein Login, kein Server, kein Build-Schritt. Alle Nutzerdaten liegen im `localStorage` des
  Geräts unter dem Schlüssel `unihockey-planer.v1`.
- Veröffentlicht über GitHub Pages aus dem Branch `gh-pages`, der nur den Inhalt von `app/`
  enthält; `sh tools/publish.sh` lädt `main` und `gh-pages` hoch. Die App läuft dort in einem
  Unterpfad (https://samuel-int.github.io/unihockey-trainingsplaner/), deshalb müssen alle Pfade
  relativ bleiben.

## Aufbau

- `app/app.js` – die ganze Logik in einer Datei (Vanilla JS). Hash-Routing; jede Ansicht ist eine
  Funktion `view…()`, die HTML als String liefert; `render()` setzt sie ein. Klicks laufen über
  Event-Delegation: `data-a="name"` ruft `A.name` auf, `data-b` bindet ein Feld an die Daten
  (`data-r="1"` rendert nach der Änderung neu). Lies die bestehenden Ansichten, bevor du etwas
  Neues baust, und halte dich an dieses Muster.
- `app/data-rtp.js` – erzeugte Datei (`window.RTP`), nie von Hand ändern. Sie entsteht mit
  `node tools/build-rtp.js` aus den `Rahmentrainingsplaene_*.xlsx` im Projektordner (die Excel-
  Dateien sind nicht im Git). Pro Stufe gibt es Blöcke mit `main` und `sec` (je `ef`
  Erscheinungsform, `sp` Schwerpunkt, `ziel` Ausbildungsziel, `gp` Good Practice), `regel`
  (Regel-Fokus), `events` und bei F/E/D Wochen mit Trainings.
- `app/data-goalie.js` – Goalie-Übungen und -Ausbildung (`window.GOALIE`), eigene Ergänzung, von
  Hand gepflegt.
- `app/style.css`, `app/index.html`, `app/manifest.webmanifest`, `app/sw.js` (Service Worker,
  Netz zuerst mit Cache-Rückfall), `app/qrcode.js` (fremde Bibliothek, nicht anfassen).
- `tools/serve.js` – lokaler Testserver auf Port 5173.

## Regeln

Daten und Zugänge bleiben bei jedem Update erhalten (verbindliche Vorgabe von Samuel, 20.11.2026):
- Nie den Speicherschlüssel `unihockey-planer.v1` ändern und nie bestehende Felder in `DB` löschen oder umbenennen. Neue Felder nur ergänzen, mit Rückfallwert für alte Daten. Nötige Umbauten als Migration beim Laden, die alte Werte übernimmt.
- Zugänge sind unantastbar: `DB.spaces` (Raum-Token und Schlüssel), `DB.me` (Gerät und Name), `DB.club` und der Admin- bzw. Funktionärsschlüssel, `DB.activeRole`. Formate (`e1.`, `w1.`, `#j=`, `#f=`) bleiben lesbar; ein neues Format nur zusätzlich, das alte weiterhin unterstützen.
- Nie die Adresse der App ändern (GitHub-Konto, Repo-Name, gh-pages-Pfad): localStorage hängt an der Adresse, sonst ist auf allen Handys alles weg.
- Supabase: Projekt, URL und Schlüssel in `sync-config.js` bleiben. SQL nur ergänzend (create or replace, add column if not exists), nie Tabellen oder Spalten mit Daten löschen, nie Token-Hashes oder `club` zurücksetzen. Kein erneutes Ausführen von `supabase.sql` auf dem echten Server.
- Service Worker: nur die Cache-Nummer erhöhen, nie localStorage oder IndexedDB leeren.
- «Alle Daten löschen», «Raum auflösen» und ähnliches nur auf ausdrücklichen Tipp der Person, nie automatisch.
- Vor dem Veröffentlichen prüfen: Alte Daten (Kopie eines bestehenden Speicherstands) laden ohne Verlust, Mannschaftsraum gleicht weiter ab, Rolle oben rechts stimmt noch.

- **Gespeicherte Daten nicht kaputt machen.** Trainer*innen haben Trainings auf ihrem Handy, die
  nirgends sonst liegen. Neue Felder müssen optional sein und einen Standardwert haben; bestehende
  Felder nicht umbenennen oder umdeuten. Dasselbe gilt für geteilte Links und Export-Dateien:
  alte müssen weiterhin importierbar bleiben.
- **Keine Abhängigkeiten, kein Build.** Kein npm, kein Framework, keine externen Skripte oder
  Schriften. Die App muss offline funktionieren.
- **Handy zuerst.** Für 375 px Breite entwerfen, Tippflächen mindestens rund 40 px hoch, heller
  und dunkler Modus über die CSS-Variablen in `style.css`.
- **Inhalte von swiss unihockey.** Beschreibungen, Skizzen und Videos aus dem UTP nicht in die
  App kopieren; die App ist öffentlich. RTP-Inhalte kommen nur über `tools/build-rtp.js`.
- **Neue Datei in `app/`?** Dann auch in die Liste `FILES` in `app/sw.js` eintragen. Bei jeder
  Änderung an App-Dateien die Versionsnummer in `CACHE` in `app/sw.js` um eins erhöhen.
- Bleib bei der gestellten Aufgabe. Fällt dir daneben etwas auf, das verbessert werden sollte,
  nenne es im Bericht, statt es ungefragt umzubauen.

## Prüfen

Nach jeder Änderung:

1. `node --check app/app.js` (und für jede andere geänderte JS-Datei).
2. Wenn du Browser-Werkzeuge hast: die Vorschau `trainingsplaner` starten (oder
   `node tools/serve.js`), die betroffene Ansicht in Handy-Breite öffnen und die Änderung wirklich
   durchklicken; Konsole auf Fehler prüfen. Testdaten danach wieder entfernen.
3. Ohne Browser: die geänderte Ansicht in Node so weit wie möglich ausführen oder den Code
   sorgfältig gegenlesen, und im Bericht klar sagen, dass nicht im Browser getestet wurde.

## Abschluss

Committe deine Änderung mit einer kurzen deutschen Nachricht, aber pushe nicht und führe
`tools/publish.sh` nicht aus: das stellt die App für alle online und ist Sache der auftraggebenden
Sitzung nach ihrer Kontrolle. Berichte dann
knapp: was sich für die Trainer*innen ändert, welche Dateien betroffen sind, was du geprüft hast
und was nicht.
