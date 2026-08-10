# DRACHENFUNKE

Bubble-Shooter fürs Handy. Ein junger Kristalldrache spuckt Edelsteine an die
Höhlendecke und bringt sie zum Einsturz.

HTML5, Canvas 2D, Vanilla JS (ES-Module). Kein Build-Step, keine externen
Bibliotheken, keine Bild- oder Sounddateien — alle Grafiken entstehen
prozedural im Code.

## Starten

ES-Module brauchen `http://`, ein Doppelklick auf `index.html` genügt nicht.
Irgendein statischer Server tut es:

```bash
python3 -m http.server 8000
# dann http://localhost:8000/ öffnen
```

## Steuerung

| Geste | Wirkung |
|---|---|
| Ziehen an beliebiger Stelle | zielt: `Winkel = eingefrorener Winkel + dx · 0,18°/px` |
| Loslassen | schießt |
| Loslassen in den unteren 15 % | bricht den Schuss ab |
| Kurzer Tipp in die obere Hälfte | zielt dorthin und schießt sofort |
| Tipp auf Drache oder Warteschlange | tauscht aktuellen und nächsten Stein |

Maus funktioniert genauso (Pointer Events).

## Stand: Meilenstein 1 — vollständig spielbar

Umgesetzt:

- **Hex-Raster**, versetzte Reihen, r = 32, gerade Reihen 11 / ungerade 10
  Steine, Reihenhöhe r·√3 = 55,4256. Beim Nachschieben rutscht das ganze Feld
  eine Reihe tiefer und verzahnt sich neu, ohne dass eine bestehende Reihe
  ihren Versatz verliert.
- **Schießen**: 1600 px/s, Kollision in Substeps von maximal 4 px,
  Wandkollision durch Spiegeln der x-Geschwindigkeit, Winkelbegrenzung 78°,
  Anhaften am nächstgelegenen freien Nachbarfeld des Treffers.
- **Regeln**: 3+ gleichfarbige entfernen, danach Erreichbarkeitsprüfung von der
  obersten Reihe, alles Lose stürzt ab (Schwerkraft, Drift, Rotation).
  Punkte 10 je geplatztem Stein, `20 · n` je abgestürztem (18 Steine = 3420).
  Kombo 1 / 1,25 / 1,5 / 2. Fünf Fehlschüsse schieben eine Reihe nach.
  Nachschubfarben ausschließlich aus den noch vorhandenen Farben, invertiert
  häufigkeitsgewichtet. Kein Timer.
- **Fail-Linie** bei y = 1000, Neustart mit identischem Layout in unter 400 ms
  ohne Zwischenbildschirm.
- **Farbfehlsichtigkeit**: jede Farbe trägt ein eigenes Symbol
  (Kreis, Raute, Dreieck, Stern, Welle).
- Vorgezogen aus Meilenstein 2: **Flugbahn-Vorschau** (gepunktet, genau eine
  Wandbande, Punktabstand 24 px, ausblendend) mit Geisterblase auf dem
  Zielfeld, **Warteschlange** mit Tauschen, sowie die komplette Steuerung.
  Vorschau und Schuss laufen durch *dieselbe* Funktion `traceShot`, können
  also gar nicht auseinanderlaufen.
- 10 feste Level für die Kristallhöhle in `data/levels.json`.

Noch offen (Meilensteine 3–6): Juice (Partikel, Screenshake, Hitstop,
Weißblitz), prozedurales Audio, Hindernisse, Power-ups, Boss, Weltkarte,
endloser Schlund, Meta.

## Dateien

```
index.html
css/style.css
js/main.js              Bootstrap
js/core/loop.js         fester Physik-Zeitschritt + rAF
js/core/input.js        Pointer -> virtuelle Koordinaten
js/core/render.js       Canvas-2D, vorgebackene Stein-Sprites
js/game/config.js       alle Kennwerte der Spezifikation
js/game/grid.js         Hex-Raster
js/game/physics.js      traceShot (Schuss + Vorschau), Absturz
js/game/match.js        Farbgruppen, Erreichbarkeit
js/game/shooter.js      Zielwinkel, Warteschlange, Nachschubfarbe
js/game/levels.js       Laden und Bauen der Layouts
js/game/game.js         Spielablauf und Regeln
js/ui/hud.js            Punkte, Kombo, Fehlschussanzeige
data/levels.json
```

`js/core/audio.js`, `js/game/{powerups,boss}.js`, `js/fx/*` und
`js/ui/{screens,map}.js` kommen mit den jeweiligen Meilensteinen dazu.

Alle Logik rechnet in virtuellen Einheiten (720 × 1280) und wird uniform auf
jede Bildschirmgröße skaliert (Letterbox).
