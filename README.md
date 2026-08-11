# DRACHENFUNKE

Bubble-Shooter fürs Handy. Ein junger Kristalldrache spuckt Edelsteine an die
Höhlendecke und bringt sie zum Einsturz.

HTML5, Canvas 2D, Vanilla JS (ES-Module). Kein Build-Step, keine externen
Bibliotheken, keine Bild- oder Sounddateien — alle Grafiken entstehen
prozedural im Code.

## Spielen

Im Browser: **https://alex1977-code.github.io/Puzzle-Bobble/**

Der Workflow `.github/workflows/pages.yml` veröffentlicht bei jedem Push auf
den Entwicklungsbranch. Es gibt keinen Build-Step — die Dateien werden nur
kopiert.

**Einmalig nötig:** unter *Settings → Pages → Build and deployment* die
Quelle auf **GitHub Actions** stellen. Ein Workflow-Token darf eine
Pages-Site nicht selbst anlegen, das lässt die GitHub-API nicht zu.

Alternativ ohne Workflow: dort *Deploy from a branch* wählen, Branch
`claude/new-session-k0b2gl`, Ordner `/ (root)`. Das Repository-Wurzel-
verzeichnis ist bereits die fertige Seite; `.nojekyll` liegt dafür bei.

## Lokal starten

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
| Tipp auf den Lautsprecher oben rechts | schaltet den Ton stumm (wird gemerkt) |

Beim allerersten Start laufen fünf Storytafeln; Tippen blättert weiter. Danach
kommen sie nicht wieder. Zum erneuten Ansehen im Browser
`localStorage.removeItem('drachenfunke.story')` ausführen und neu laden.

Maus funktioniert genauso (Pointer Events).

Ton startet erst nach der ersten Berührung — so verlangen es die
Autoplay-Regeln der Browser.

## Stand: Meilensteine 1 bis 3

### Meilenstein 1 — Kern

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
- 10 feste Level für die Kristallhöhle in `data/levels.json`.

### Meilenstein 2 — Steuerung, Vorschau, Warteschlange

- Ziehen an beliebiger Stelle, Winkel = eingefrorener Winkel + dx · 0,18°/px,
  Schuss beim Loslassen, Abbruch in den unteren 15 %, kurzer Tipp oben zielt
  dorthin und feuert sofort.
- **Flugbahn-Vorschau**: gepunktet, genau eine Wandbande, Punktabstand 24 px,
  nach hinten ausblendend, mit halbtransparenter Geisterblase auf dem
  errechneten Zielfeld. Vorschau und Schuss laufen durch *dieselbe* Funktion
  `traceShot` — sie können gar nicht auseinanderlaufen.
- Warteschlange aus aktuellem und nächstem Stein, Tippen auf den Drachen
  tauscht beide.
- Fehlschuss-Reihe mit 300-ms-Animation und Rumpeln.

### Grafik und Musik

- **Prozedurale Grafik**: facettierter Kristalldrache, dessen Kopf sich um den
  Abschusspunkt dreht, sodass der geladene Stein bei jedem Winkel im Maul
  bleibt. Jedes Biom hat eine eigene Bildsprache statt nur eigener Farben —
  Kristallzacken und Drusen, Pilzhüte und Sporenlicht, Ambosse und Glutrisse,
  Eiszapfen und Frostfarne, Wolkenbänke und schwebende Türme. Ein
  Beruhigungsschleier zwischen Ferne und Vordergrund hält das Spielfeld
  lesbar. Steine haben einen vereinfachten Brillantschliff; die fünf Symbole
  liegen darüber und bleiben klar erkennbar.
- **Fünf Storytafeln** in `js/ui/story.js`, prozedural gezeichnet wie alles
  andere. Laufen einmal beim ersten Start.
- **Musik je Biom** mit eigenem Tempo, eigener Tonart und eigener
  Instrumentierung, Großform aus mehreren Durchläufen statt kurzem Loop,
  gemeinsamer Hallraum für Musik und Effekte, und eine Absenkung der Musik bei
  jedem Effekt, damit die Trefferleiter immer obenauf steht.

### Meilenstein 3 — Juice und Audio

- **Platzen**: Squash-Stretch über 120 ms, 8–14 Partikel in Steinfarbe, radial
  mit Reibung.
- **Screenshake**: Amplitude = min(2 + Kombogröße · 1,2 ; 14) px, Abklingen
  über 250 ms. Als Kombogröße zählt, was der Schuss insgesamt entfernt hat —
  geplatzte plus abgestürzte Steine.
- **Hitstop**: 70 ms Zeitlupe ab 6 abstürzenden Steinen, in echter Zeit
  gemessen, damit sich die Verlangsamung nicht selbst verlangsamt.
- **Absturz**: Weißblitz-Overlay bei 15 % Deckkraft, Funkenregen in den Hort
  am unteren Rand.
- **Object-Pooling**: fest vorbelegte typisierte Arrays, Swap-Remove statt
  splice. Gemessen 60 fps bei über 300 gleichzeitigen Partikeln — und das im
  reinen Software-Rasterizer des Testbrowsers, also mit Reserve auf echter
  Hardware.
- **Audio** komplett prozedural über die Web Audio API, keine Dateien:
  Platz-Blips steigen je Treffer eine Stufe in der pentatonischen Leiter
  (C D E G A) und fallen nach 1,5 s Pause zurück; Absturz als abfallendes
  Glissando mit Rauschimpuls; Hintergrundmusik je Biom mit eigener Tonart, ab
  Kombo 3 kommt eine Instrumentenspur dazu. Stummschalter oben rechts.
- `prefers-reduced-motion` dämpft Screenshake und lässt den Weißblitz weg.

Noch offen (Meilensteine 4–6): Hindernisse, Level-System über alle Biome,
Power-ups, Boss, Weltkarte, endloser Schlund, Meta.

## Dateien

```
index.html
css/style.css
js/main.js              Bootstrap
js/core/loop.js         fester Physik-Zeitschritt + rAF + Hitstop
js/core/input.js        Pointer -> virtuelle Koordinaten
js/core/render.js       Canvas-2D, vorgebackene Sprites
js/core/audio.js        prozedurale Klänge und Biom-Musik
js/game/config.js       alle Kennwerte der Spezifikation
js/game/grid.js         Hex-Raster
js/game/physics.js      traceShot (Schuss + Vorschau), Absturz
js/game/match.js        Farbgruppen, Erreichbarkeit
js/game/shooter.js      Zielwinkel, Warteschlange, Nachschubfarbe
js/game/levels.js       Laden und Bauen der Layouts
js/game/game.js         Spielablauf und Regeln
js/fx/particles.js      Partikel-Pool (typisierte Arrays)
js/fx/shake.js          Screenshake
js/fx/juice.js          Regie: Platzen, Absturz, Hitstop, Blitz
js/ui/hud.js            Punkte, Kombo, Fehlschussanzeige, Ton
js/ui/story.js          fünf prozedural gezeichnete Storytafeln
data/levels.json
```

`js/game/{powerups,boss}.js` und `js/ui/{screens,map}.js` kommen mit den
Meilensteinen 4 und 5 dazu.

Alle Logik rechnet in virtuellen Einheiten (720 × 1280) und wird uniform auf
jede Bildschirmgröße skaliert (Letterbox).
