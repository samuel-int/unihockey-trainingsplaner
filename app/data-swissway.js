/* Swiss Way Warm-up: Übungen und Dosierung.
   Quelle: offizielles Poster «Swiss Way Warm-up» von swiss unihockey (SUH-WarmUp-SwissWay-A0-dt-RZ-2.0) und die Beschreibung im Unihockey-Trainingsplaner (UTP).
   © swiss unihockey, Verwendung mit Einverständnis, nicht-kommerziell. Von Hand eingetragen (kein Erzeugnis von tools/); die Auswahl pro Training steht in app.js (swissWayPlan).
   Jede Übung: n Name, t Kurzanleitung, d Dosierung. */
window.SWISSWAY = {
  quelle: 'swiss unihockey, Poster «Swiss Way Warm-up» (Verwendung mit Einverständnis)',
  parts: [
    {
      key: 'p1', titel: 'Sensorische Aktivierung', min: '3 Min.', pro: 'pro Training 2–4 Übungen, idealerweise immer zum Start',
      basis: [
        { n: 'Sensorisches Warm-up', t: 'Hautrezeptoren durch Reibung aktivieren', d: '30 Sekunden' },
        { n: 'Augenkreis', t: 'Augenmuskulatur aktivieren: das Auge folgt dem Daumen, der Kopf bleibt an Ort', d: '5× pro Richtung' },
        { n: 'Bouncing', t: 'Gleichgewichtssystem aktivieren, Blickfokus halten, das Ziel scharf sehen', d: '20 Sekunden' },
        { n: 'Blicksprünge', t: 'Im Einbeinstand den Kopf seitlich rotieren und beide Daumen abwechselnd fokussieren', d: '20 Sekunden' },
      ],
      erg: [
        { n: 'Kopfrotation', t: 'Im Einbeinstand den Kopf seitlich rotieren und den Blick auf dem Daumen halten', d: '20 Sekunden' },
        { n: 'Blickverfolgung', t: 'Im Ausfallschritt verfolgt der Kopf den Daumen, stabile Position halten', d: '5× pro Richtung' },
      ],
    },
    {
      key: 'p2', titel: 'Bewegungsvorbereitung', min: '7 Min.', pro: 'pro Training 6–8 Übungen, danach bei Bedarf Jogging',
      basis: [
        { n: 'Fussgelenke', t: 'Fussgelenke zur Aussen- und Innenseite abkippen, anschliessend kreisen', d: '5× pro Fuss' },
        { n: 'Knie kreisen', t: 'Ausfallschritt nach vorne, das Kniegelenk in beide Richtungen kreisen', d: '5× pro Richtung' },
        { n: 'Hüftpendel', t: 'Knie anheben, den Unterschenkel nach aussen und innen pendeln, stabile Position halten', d: '15 Sekunden pro Bein' },
        { n: 'Hüftkreis', t: 'Knie anheben, zur Seite und nach hinten kreisen, stabile Position halten', d: '5× pro Richtung' },
        { n: 'World’s greatest stretch', t: 'Im tiefen Ausfallschritt Arme und Oberkörper ausdrehen, der Blick folgt dem Arm', d: '5× pro Seite' },
        { n: 'Kompass-Schritte', t: 'Aufeinanderfolgende Ausfallschritte im Kreis, Blickfokus halten', d: 'Oberkörper 3× pro Stellung rotieren, 7 Schritte pro Bein' },
        { n: 'Standwaage', t: 'Bein und Oberkörper in die Waagrechte bringen und kurz halten', d: '6× pro Bein' },
        { n: 'Drop Sets', t: 'Harte Landungen aus der Hochhalteposition, auf ein visuelles oder akustisches Signal', d: '2 Serien à 6 Landungen' },
      ],
      erg: [
        { n: 'Mobilisation Vorderseite', t: 'Ausfallschritt nach hinten, Schulter und Arme strecken', d: '6× pro Bein' },
        { n: 'Reflexive Stabilität', t: 'Stabile Position im Ausfallschritt, die Partnerin / der Partner gibt Impulse an Arm, Schulter oder Becken', d: '30 Sekunden' },
        { n: 'Wirbelsäule aktivieren', t: 'In stabiler Position mit geradem Rücken den Oberkörper zur Seite drehen, der Blick folgt der Bewegung', d: '5× pro Seite' },
      ],
    },
    {
      key: 'p3', titel: 'Bewegungskontrolle', min: '5–10 Min.', pro: 'mindestens zwei passende Themen, je nach Trainingsschwerpunkt',
      items: [
        { n: 'Drop Sets Varianten', t: 'Kommandos mit Tappings und anderen Aufgaben nach den Landungen', d: '3 Serien à 5 Sekunden' },
        { n: 'Laufschule', t: 'Skippingvarianten vorwärts, seitwärts, rückwärts', d: '15 m pro Variante' },
        { n: 'Explosive Sprünge', t: 'Beidbeinige und einbeinige Sprünge in die Höhe an Ort', d: '3 Sprünge pro Variante' },
        { n: 'Richtungswechsel', t: 'Kurze «stop and go»-Bewegungen auf ein visuelles oder akustisches Signal', d: '5× pro Variante' },
        { n: 'Beschleunigung', t: 'Sprints aus verschiedenen Ausgangspositionen', d: '5–10 Sprints à 5–20 m' },
        { n: 'Zweikämpfe', t: 'Verschiedene Formen von Zweikampfübungen', d: '30 Sekunden pro Variante' },
      ],
    },
  ],
  // Erschweren laut UTP-Beschreibung (pro Training eine Idee)
  erschweren: ['Kopf- oder Oberkörperrotation dazunehmen', 'Störungen einbauen', 'Bewegungsrichtung wechseln (linear, lateral)', 'Auslösung variieren (selber, akustisch, visuell)'],
};
