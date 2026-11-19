/* Hilfe-Texte (statischer Inhalt, von Hand geschrieben). Wird von app.js in «Mehr › Hilfe» und auf der Willkommensseite benutzt.
   host: true = Abschnitt für Haupttrainer (auf Geräten, die nur Co-Trainer-/Nur-Lesen-Mannschaften haben, steht er am Ende). */
window.HELP = [
  { id: 'start', t: 'Erste Schritte', s: [
    '<b>App installieren:</b> Android (Chrome): Menü ⋮ → «App installieren». iPhone (Safari): Teilen-Symbol → «Zum Home-Bildschirm». Danach öffnest du die App wie jede andere, auch ohne Internet.',
    '<b>Du bist Co-Trainer?</b> Öffne auf diesem Handy den Einladungslink, den dir dein Haupttrainer geschickt hat (zum Beispiel per WhatsApp). Tippe auf «Beitreten»: Die Mannschaft mit allen Trainings erscheint, du musst nichts abtippen.',
    '<b>Du bist Haupttrainer?</b> Tippe unten auf «Teams» und dann auf «+ Neu», um deine Mannschaft anzulegen. Wie du Co-Trainer einlädst, steht weiter unten.',
    '<b>«Co-Trainer»</b> heisst: du darfst alles ansehen und ändern (Trainings, Anwesenheit, Reflexion). Alles gleicht sich automatisch mit den anderen ab.',
    '<b>«Nur lesen»</b> heisst: du siehst alles, kannst aber nichts ändern. Das ist für Helfer im Trainerstaff gedacht, die nur mitschauen. Nicht für Eltern: Der Link zeigt auch Anwesenheiten und Notizen zu Spielern.',
    'Es gibt kein Konto und kein Passwort. Der Einladungslink ist dein Schlüssel zur Mannschaft: Schick ihn nicht weiter und stell ihn nicht in grosse Gruppenchats.'
  ] },
  { id: 'prep', t: 'Ein Training vorbereiten', s: [
    'Tippe unten auf «Trainings» und dann auf das Training. Es öffnet sich der Editor mit allen Übungen in der Reihenfolge der Halle.',
    'Tippe eine Übung an, um sie aufzuklappen. Bei den meisten Übungen steht oben die <b>Erklärung</b>: Beschreibung, Keypoints, Coachingfragen und Variationen.',
    'Skizzen und Videos gibt es im UTP von swiss unihockey. Tippe dafür bei der Übung auf «Im UTP öffnen» (braucht Internet).',
    'Im Kopf des Trainings steht die Zeile <b>«Material»</b>. Sie zählt zusammen, was du für das ganze Training brauchst. Stimmt bei einer Übung etwas nicht, schreib es im Feld «Material» der Übung hin.',
    'Mit «‹ Vorheriges» und «Nächstes ›» (oder Wischen) blätterst du zum Training davor oder danach.',
    'Die Karte «Vom letzten Training» zeigt dir, was ihr beim letzten Mal notiert habt.'
  ] },
  { id: 'hall', t: 'In der Halle: Hallenmodus, Timer, Training beenden', s: [
    'Öffne das Training und tippe auf <b>«▶ Start»</b>. Der Bildschirm bleibt an.',
    'Starte und pausiere den Timer, mit «Weiter» und «Zurück» wechselst du die Übung. Die Erklärung kannst du pro Übung aufklappen.',
    'Wenn du «Im UTP öffnen» antippst und zurückkommst, geht es bei derselben Übung weiter. Der Timer steht dann auf Pause.',
    'Bei der letzten Übung heisst der Knopf <b>«Training beenden ✓»</b>. Danach hakst du die Anwesenheit ab und füllst die Reflexion aus.',
    'Mit «Später» kannst du jederzeit aufhören und es nachholen, etwa im Zug nach Hause.'
  ] },
  { id: 'att', t: 'Anwesenheit erfassen', s: [
    'Tippe im Training auf <b>«Anwesenheit»</b> (oder du kommst nach «Training beenden ✓» automatisch dorthin).',
    'Hake ab, wer da ist. Mit «Alle anwesend» geht es schneller, dann nimmst du nur die Fehlenden heraus.',
    'Wähle bei Bedarf die Art: Training, Wettkampf oder Trainingstag. Das braucht der Haupttrainer für die J+S-Abrechnung.',
    'Die Übersicht pro Mannschaft steht auf der Mannschaftsseite unter «Anwesenheit / J+S».',
    'Die Spielerliste pflegt der Haupttrainer. Hast du Co-Trainer-Rechte, kannst du sie auch ergänzen.'
  ] },
  { id: 'refl', t: 'Reflexion ausfüllen', s: [
    'Nach dem Training tippst du auf «Reflexion» (oder sie kommt nach der Anwesenheit). Es dauert zwei bis drei Minuten.',
    'Beantworte: Ziel erreicht? Dazu drei Skalen (Intensität, Konzentration, eigene Leitung) und pro Übung 👍 ➖ 👎. Bei 👎 schreibst du kurz den Grund auf.',
    'Schreib zwei Sätze: «Was hat funktioniert?» und «Was ändere ich nächstes Mal?». Notizen zu einzelnen Spielern sind eingeklappt und freiwillig.',
    '<b>Wozu das gut ist:</b> Die Reflexion kommt wieder. Im nächsten Training derselben Mannschaft siehst du die Karte «Vom letzten Training». Bei den Übungen steht, wie sie zuletzt liefen («Zuletzt: 👍 2× · 👎 1×»).',
    'Vergangene Trainings ohne Reflexion zeigen «✎ Reflexion offen». Du kannst sie über den Knopf «Reflexion» im Training nachholen.'
  ] },
  { id: 'match', t: 'Wettkampf erfassen und abschliessen', s: [
    'Tippe auf der Mannschaftsseite auf <b>«+ Wettkampf»</b> (oder unter «Trainings» auf «+ Neu» und «Wettkampf»).',
    'Trage Datum, Art (Spiel oder Turnier), Gegner, Ziel und Ort ein. Bei einem Turnier gibst du mehrere Gegner an.',
    'Nach dem Spiel tippst du auf <b>«Wettkampf abschliessen»</b>. Erst die Anwesenheit (sie geht als «Wettkampf» in die J+S-Abrechnung), dann die Reflexion.',
    'In der Reflexion trägst du Resultate, Ziel, Skalen und Spielphasen ein. Am Schluss steht «Was nehmen wir ins Training mit?».',
    'Diese Punkte erscheinen im nächsten Training als Karte «Vom letzten Wettkampf».'
  ] },
  { id: 'plan', t: 'Mannschaft, Saison und Blöcke planen', host: true, s: [
    '<b>Mannschaft anlegen:</b> «Teams» → «+ Neu». Trage Name, Stufe und Farbe ein. Setze mit «+ Trainingszeit hinzufügen» pro Einheit Wochentag, Start, Dauer und Ort.',
    '<b>Co-Trainer einladen:</b> Öffne die Mannschaft und tippe auf «Mannschaft teilen». Tippe auf «Co-Trainer einladen» (darf ändern) oder «Nur-Lesen-Link» und schick den Link <b>einzeln</b> an die Person.',
    '<b>Einzelnes Training:</b> «Trainings» → «+ Neu». Wähle «Aus dem RTP», «Über die Saisonplanung» oder «Leeres Training».',
    '<b>Ganzen Block planen:</b> Auf der Mannschaftsseite «Ganzen Block planen». Wähle den Block und den Start (jetzt oder nach Saisonplan), prüfe die Vorschau und tippe auf «Trainings anlegen». Danach geht «Rückgängig».',
    '<b>Saison:</b> Unter «Trainings» → «Saison» siehst du den Wochenplan. Die Saison läuft vom 1. Mai bis 30. April. Ferienwochen und eigenen Saisonstart stellst du dort ein.',
    '<b>Sichern:</b> Unter «Mehr» → «Alles exportieren» sicherst du alle Daten in einer Datei, zum Beispiel vor einem Handywechsel.'
  ] },
  { id: 'js', t: 'J+S-Abrechnung', host: true, s: [
    'Die Reihenfolge in der NDS ist immer: <b>Personen → Aktivitäten → Anwesenheitskontrolle (AWK)</b>. Personen und Aktivitäten müssen im Kurs schon erfasst sein.',
    'Warte mit dem Import bis <b>nach Kursende</b>. Der Import von Aktivitäten löscht laut BASPO alle schon erfassten Aktivitäten samt Anwesenheiten im Kurs.',
    'Exportiere die Datei auf der Mannschaftsseite unter «Anwesenheit / J+S» mit «AWK für J+S (CSV)». In der Datei steht statt der J+S-Personennummer der Name, genau so, wie du ihn in der Spielerliste erfasst hast: Öffne sie in Excel oder einem Editor, ersetze mit «Suchen und Ersetzen» jeden Namen durch die Personennummer aus der NDS, speichere als CSV (UTF-8) und importiere sie in der NDS. Der Prüfdialog listet alle Namen, die du ersetzen musst, und warnt bei Trainings ohne Ort oder Startzeit und bei ungewöhnlichen Dauern.',
    'Die App speichert bewusst keine J+S-Nummern, damit die Kinder nicht eindeutig zugeordnet werden können. Dafür muss jeder Name in einer Mannschaft nur einmal vorkommen; bei zwei gleichen Namen ergänze einen zweiten Buchstaben (Daniel M. / Daniel Mü.). Lösche die Datei nach dem Import: sie enthält Namen von Kindern.',
    'Als Dauer zählt das Feld «Dauer» im Training (Hallenzeit), nicht die Summe der Übungen.',
    'Trag dich selbst über «+ Leiter/in» in die Spielerliste ein, damit du in der Abrechnung erscheinst.',
    'Führe die Anwesenheit nicht gleichzeitig in der App «Mobile NDS» und hier. Sonst hast du zwei verschiedene Stände.'
  ] },
  { id: 'faq', t: 'Häufige Fragen', s: [
    '<b>Ich sehe die Mannschaft nicht.</b> Öffne den Einladungslink nochmals, auf diesem Handy und mit Internet, und tippe auf «Beitreten». Klappt es immer noch nicht, frag den Haupttrainer, ob der Link noch gilt.',
    '<b>Meine Änderung ist beim anderen nicht da.</b> Beide Handys brauchen Internet. Öffne die App einmal: Sie gleicht sich beim Öffnen, bei Rückkehr in die App und danach laufend automatisch ab. Ohne Netz wird es nachgeholt, sobald du wieder online bist.',
    '<b>Ich habe ein neues Handy.</b> Bitte den Haupttrainer um einen Einladungslink und öffne ihn auf dem neuen Handy. Hat der Haupttrainer inzwischen «Zugang erneuern» getippt, braucht er dafür ohnehin einen neuen. Deine Daten holt sich das neue Handy automatisch aus der Mannschaft.',
    '<b>Ich kann nichts ändern.</b> Dann hast du die Rolle «Nur lesen». Frag den Haupttrainer nach einem Co-Trainer-Link.',
    '<b>Läuft die App auch in der Halle ohne Internet?</b> Ja. Öffne sie vorher einmal mit Internet, dann läuft sie auch ohne.',
    '<b>Eine neue Version holen:</b> Schliesse die App ganz und öffne sie mit Internet neu.'
  ] }
];
