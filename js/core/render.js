/**
 * Canvas-2D-Renderer.
 *
 * Alle Grafiken entstehen prozedural im Code — keine Bilddateien, kein SVG.
 *
 * Grundregel des Hauses: gebacken wird einmal, gezeichnet wird jedes Bild.
 * Steine, Funken, Splitter, sämtliche Drachenteile und der komplette
 * Biom-Hintergrund liegen als Offscreen-Canvasse bereit; pro Bild bleibt davon
 * nur noch ein drawImage übrig. Das ist der entscheidende Hebel für 60 fps auf
 * Mittelklasse-Geräten — eine Transformation je Objekt kostet gemessen das
 * Sechsfache des Zeichnens (350 x save/rotate/restore = 24 ms gegenüber 4 ms).
 */
import {
  VW, VH, R, D, PLAY_LEFT, PLAY_RIGHT, CEILING_Y, FAIL_Y,
  COLORS, PREVIEW_DOT_SPACING, PREVIEW_MAX_BOUNCES, SHOOTER_X, SHOOTER_Y,
  POP_MS, HOARD_Y,
} from '../game/config.js';
import { SPLITTER } from '../fx/particles.js';

const SPRITE_PAD = 6;   // Platz für Glanzrand innerhalb der Sprite-Kachel
const SPARK_SIZE = 28;  // Kantenlänge der Funken-Kachel in virtuellen Einheiten
const OVERSCAN = 20;    // Reserve am Rand für den Screenshake

// Kristallsplitter werden in 16 fertig gedrehten Bildern je Farbe vorgebacken.
// Eine Drehung zur Laufzeit kostet pro Partikel ein save/rotate/restore, und
// das ist bei 300 Partikeln um Größenordnungen teurer als das Zeichnen selbst.
const SHARD_SIZE = 26;
const SHARD_FRAMES = 16;

// --- Drache: alles in Einheiten relativ zum Abschusspunkt (360, 1150) --------
// Der Abschusspunkt ist zugleich die Mitte des geladenen Steins im Maul und
// darf sich nicht verschieben — er ist der Nullpunkt der Physik.
const HEAD_LEAN = 0.4;      // Anteil, mit dem der Kopf in die Zielrichtung kippt
const WING_LEAN = 0.06;     // die Flügel folgen nur angedeutet
const RECOIL_PX = 14;       // Rückstoßweg des Kopfes entgegen der Schussrichtung

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.dpr = 1;
    /** @type {Map<string, HTMLCanvasElement>} */
    this.sprites = new Map();
    /** @type {Map<string, {cv:HTMLCanvasElement,x:number,y:number,w:number,h:number}>} */
    this.layers = new Map();
    this.spriteScale = 0;
    this.bg = null;
    this.bgKey = '';
    this.resize();
  }

  // --- Ansicht --------------------------------------------------------------

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);

    // Uniform skalieren, Rest als Letterbox.
    const s = Math.min(w / VW, h / VH);
    this.scale = s * dpr;
    this.offsetX = Math.round((w * dpr - VW * this.scale) / 2);
    this.offsetY = Math.round((h * dpr - VH * this.scale) / 2);

    if (Math.abs(this.spriteScale - this.scale) > 0.01) this._buildSprites();
    this.bg = null;   // Hintergrund im neuen Maßstab neu backen
  }

  /** Bildschirm- in virtuelle Koordinaten. */
  toVirtual(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (this.canvas.width / rect.width);
    const py = (clientY - rect.top) * (this.canvas.height / rect.height);
    return {
      x: (px - this.offsetX) / this.scale,
      y: (py - this.offsetY) / this.scale,
    };
  }

  /**
   * @param {{x:number,y:number}} shake Kameraversatz in virtuellen Einheiten.
   * Der Beschnitt bleibt im Bildschirmraum stehen, nur der Inhalt wackelt —
   * deshalb überzeichnen Hintergrund und Overlays den Rand um OVERSCAN.
   */
  begin(shake = null) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07050f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VW, VH);
    ctx.clip();
    if (shake && (shake.x || shake.y)) ctx.translate(shake.x, shake.y);
  }

  end() {
    this.ctx.restore();
  }

  // --- Sprites --------------------------------------------------------------

  _buildSprites() {
    this.spriteScale = this.scale;
    this.sprites.clear();
    this.layers.clear();
    for (let i = 0; i < COLORS.length; i++) {
      this.sprites.set(`gem${i}`, this._bakeGem(COLORS[i]));
      this.sprites.set(`funke${i}`, this._bakeSpark(COLORS[i]));
      this.sprites.set(`splitter${i}`, this._bakeShards(COLORS[i]));
    }
    this.shardFrame = Math.max(4, Math.ceil(SHARD_SIZE * this.spriteScale));
    this._bakeDragon();
  }

  /**
   * Offscreen-Ebene in virtuellen Einheiten anlegen. Der zurückgegebene Kontext
   * rechnet bereits in lokalen Koordinaten; gezeichnet wird die Ebene später
   * mit `_layer(name)` an genau derselben Stelle.
   */
  _newLayer(name, x, y, w, h) {
    const s = this.spriteScale || 1;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * s));
    cv.height = Math.max(1, Math.ceil(h * s));
    const g = cv.getContext('2d');
    g.setTransform(s, 0, 0, s, -x * s, -y * s);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    this.layers.set(name, { cv, x, y, w, h });
    return g;
  }

  /** Eine vorgebackene Ebene zeichnen — ein drawImage, keine Transformation. */
  _layer(name) {
    const l = this.layers.get(name);
    if (l) this.ctx.drawImage(l.cv, l.x, l.y, l.w, l.h);
  }

  /** Bilderstreifen mit SHARD_FRAMES fertig gedrehten Kristallsplittern. */
  _bakeShards(color) {
    const k = Math.max(4, Math.ceil(SHARD_SIZE * this.spriteScale));
    const cv = document.createElement('canvas');
    cv.width = k * SHARD_FRAMES;
    cv.height = k;
    const g = cv.getContext('2d');
    const scale = k / SHARD_SIZE;
    const h = SHARD_SIZE / 2;

    for (let f = 0; f < SHARD_FRAMES; f++) {
      g.setTransform(scale, 0, 0, scale, f * k, 0);
      g.save();
      g.translate(h, h);
      g.rotate((f / SHARD_FRAMES) * Math.PI * 2);

      const grad = g.createLinearGradient(0, -h * 0.8, 0, h * 0.8);
      grad.addColorStop(0, color.light);
      grad.addColorStop(0.55, color.base);
      grad.addColorStop(1, color.dark);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, -h * 0.78);
      g.lineTo(h * 0.42, -h * 0.05);
      g.lineTo(0, h * 0.7);
      g.lineTo(-h * 0.34, h * 0.02);
      g.closePath();
      g.fill();

      // Bruchkante: eine helle Facette macht aus dem Blatt eine Scherbe.
      g.fillStyle = hexA(color.light, 0.5);
      g.beginPath();
      g.moveTo(0, -h * 0.78);
      g.lineTo(h * 0.42, -h * 0.05);
      g.lineTo(0, h * 0.16);
      g.closePath();
      g.fill();

      g.strokeStyle = hexA(color.light, 0.8);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, -h * 0.78);
      g.lineTo(h * 0.42, -h * 0.05);
      g.lineTo(0, h * 0.7);
      g.lineTo(-h * 0.34, h * 0.02);
      g.closePath();
      g.stroke();
      g.restore();
    }
    return cv;
  }

  /** Weicher Glutpunkt, additiv gezeichnet — die Grundform aller Partikel. */
  _bakeSpark(color) {
    const sv = SPARK_SIZE;
    const px = Math.max(8, Math.ceil(sv * this.spriteScale));
    const cv = document.createElement('canvas');
    cv.width = px; cv.height = px;
    const g = cv.getContext('2d');
    g.setTransform(px / sv, 0, 0, px / sv, 0, 0);
    const c = sv / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.32, hexA(color.light, 0.85));
    grad.addColorStop(0.62, hexA(color.base, 0.5));
    grad.addColorStop(1, hexA(color.base, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    return cv;
  }

  _spriteSizeVirtual() { return D + SPRITE_PAD * 2; }

  /**
   * Ein Kristallstein: Rohling, Facettenschliff, Tafel, Symbol, Glanz.
   *
   * Der Schliff ist ein vereinfachter Brillantschnitt — sechs Kronfacetten
   * nach außen, sechs nach innen, dazwischen die Tafel. Die Helligkeit jeder
   * Facette folgt einer festen Lichtrichtung von links oben, dadurch entsteht
   * Tiefe ohne einen einzigen Schatten-Weichzeichner.
   *
   * Das Symbol für Farbfehlsichtige liegt ÜBER dem Schliff und bekommt eine
   * eingravierte Dunkelkante: Es muss auf jeder Facette lesbar bleiben, das ist
   * eine Barrierefreiheitsanforderung und keine Verzierung.
   */
  _bakeGem(color) {
    const sv = this._spriteSizeVirtual();
    const s = this.spriteScale;
    const px = Math.max(8, Math.ceil(sv * s));
    const cv = document.createElement('canvas');
    cv.width = px; cv.height = px;
    const g = cv.getContext('2d');
    g.setTransform(px / sv, 0, 0, px / sv, 0, 0);
    g.lineJoin = 'round';

    const cx = sv / 2, cy = sv / 2;
    const rr = R - 1.2;

    // Weicher Außenschein
    const halo = g.createRadialGradient(cx, cy, R * 0.7, cx, cy, R + SPRITE_PAD);
    halo.addColorStop(0, hexA(color.base, 0.34));
    halo.addColorStop(1, hexA(color.base, 0));
    g.fillStyle = halo;
    g.beginPath();
    g.arc(cx, cy, R + SPRITE_PAD, 0, Math.PI * 2);
    g.fill();

    // Rohling
    const body = g.createRadialGradient(cx - R * 0.34, cy - R * 0.42, R * 0.1, cx, cy, R);
    body.addColorStop(0, color.light);
    body.addColorStop(0.42, color.base);
    body.addColorStop(1, color.dark);
    g.fillStyle = body;
    g.beginPath();
    g.arc(cx, cy, rr, 0, Math.PI * 2);
    g.fill();

    g.save();
    g.beginPath();
    g.arc(cx, cy, rr, 0, Math.PI * 2);
    g.clip();

    // --- Schliff -----------------------------------------------------------
    const N = 6;
    const rin = R * 0.5;
    const light = -2.3;     // Lichteinfall von links oben
    const inner = [], outer = [];
    for (let i = 0; i < N; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / N;
      inner.push([cx + Math.cos(a) * rin, cy + Math.sin(a) * rin, a]);
      const b = a + Math.PI / N;
      outer.push([cx + Math.cos(b) * R * 1.08, cy + Math.sin(b) * R * 1.08, b]);
    }
    const facet = (pts, ang) => {
      const k = Math.cos(ang - light);
      g.fillStyle = k > 0
        ? `rgba(255,255,255,${(0.055 + k * 0.15).toFixed(3)})`
        : `rgba(12,4,28,${(0.05 - k * 0.19).toFixed(3)})`;
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.10)';
      g.lineWidth = 0.9;
      g.stroke();
    };
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const p = (i + N - 1) % N;
      facet([inner[i], inner[j], outer[i]], outer[i][2]);
      facet([inner[i], outer[p], outer[i]], inner[i][2] + Math.PI * 0.08);
    }

    // Tafel: die ruhige Fläche in der Mitte, auf der das Symbol sitzt
    const tab = g.createLinearGradient(cx - rin, cy - rin, cx + rin, cy + rin);
    tab.addColorStop(0, hexA(color.light, 0.55));
    tab.addColorStop(0.5, hexA(color.base, 0.12));
    tab.addColorStop(1, hexA(color.dark, 0.42));
    g.fillStyle = tab;
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const [x, y] = inner[i];
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    g.stroke();

    // Brechung: ein heller Lichtkeil quer durch den Stein
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.beginPath();
    g.moveTo(cx - R, cy - R * 0.1);
    g.lineTo(cx + R * 0.3, cy - R);
    g.lineTo(cx + R * 0.62, cy - R * 0.72);
    g.lineTo(cx - R * 0.72, cy + R * 0.2);
    g.closePath();
    g.fill();

    // Tiefe: der untere Rand liegt im Schatten
    const deep = g.createRadialGradient(cx, cy + R * 0.5, R * 0.2, cx, cy + R * 0.15, R);
    deep.addColorStop(0, hexA(color.dark, 0));
    deep.addColorStop(1, hexA(color.dark, 0.5));
    g.fillStyle = deep;
    g.beginPath();
    g.arc(cx, cy, rr, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // Innerer Lichtrand oben, dunkle Kontur außen: trennt benachbarte Steine
    g.strokeStyle = hexA(color.light, 0.6);
    g.lineWidth = 1.8;
    g.beginPath();
    g.arc(cx, cy, rr - 1.6, Math.PI * 0.85, Math.PI * 1.95);
    g.stroke();
    g.strokeStyle = 'rgba(8,3,20,0.42)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(cx, cy, rr - 0.2, 0, Math.PI * 2);
    g.stroke();

    // Symbol für Farbfehlsichtige — über dem Schliff, mit Gravurkante
    g.save();
    g.translate(cx, cy);
    drawSymbol(g, color.symbol, R * 0.47);
    g.restore();

    // Glanzlicht: klein und außermittig, damit es das Symbol nicht überstrahlt
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gl = g.createRadialGradient(cx - R * 0.42, cy - R * 0.5, 0, cx - R * 0.42, cy - R * 0.5, R * 0.4);
    gl.addColorStop(0, 'rgba(255,255,255,0.9)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl;
    g.beginPath();
    g.ellipse(cx - R * 0.4, cy - R * 0.48, R * 0.34, R * 0.22, -0.55, 0, Math.PI * 2);
    g.fill();
    // Gegenlicht am unteren Rand — lässt den Stein rund wirken
    g.strokeStyle = hexA(color.light, 0.35);
    g.lineWidth = 2.6;
    g.beginPath();
    g.arc(cx, cy, rr - 2.6, Math.PI * 0.12, Math.PI * 0.62);
    g.stroke();
    g.restore();

    return cv;
  }

  /**
   * Stein an virtueller Position zeichnen.
   * Der Regelfall (Raster, ohne Optionen) läuft ohne jede Transformation —
   * genau ein drawImage. Nur Drehung oder Squash gehen den teuren Weg.
   */
  drawStone(color, x, y, opt) {
    const sprite = this.sprites.get(`gem${color}`);
    if (!sprite) return;
    const ctx = this.ctx;
    const sv = this._spriteSizeVirtual();
    if (opt === undefined) {
      ctx.drawImage(sprite, x - sv / 2, y - sv / 2, sv, sv);
      return;
    }
    const { alpha = 1, scale = 1, rot = 0, sx = 1, sy = 1 } = opt;
    if (rot === 0 && sx === 1 && sy === 1) {
      const w = sv * scale;
      const prev = ctx.globalAlpha;
      if (alpha !== 1) ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, x - w / 2, y - w / 2, w, w);
      if (alpha !== 1) ctx.globalAlpha = prev;
      return;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    const kx = scale * sx, ky = scale * sy;
    if (kx !== 1 || ky !== 1) ctx.scale(kx, ky);
    ctx.drawImage(sprite, -sv / 2, -sv / 2, sv, sv);
    ctx.restore();
  }

  /**
   * Partikel. Beide Durchgänge kommen ohne Transformation je Partikel aus:
   * Funken sind runde Glutpunkte (additiv), Splitter greifen sich das passende
   * vorgedrehte Bild aus dem Streifen. Ein drawImage pro Partikel, sonst nichts.
   */
  drawParticles(p) {
    const ctx = this.ctx;
    const n = p.count;
    if (!n) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Weiche Glutpunkte und kleine Splitter brauchen keine Interpolation beim
    // Herunterskalieren — das spart rund ein Viertel der Zeichenzeit.
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < n; i++) {
      if (p.kind[i] === SPLITTER) continue;
      const sprite = this.sprites.get(`funke${p.color[i]}`);
      if (!sprite) continue;
      const k = p.life[i] / p.ttl[i];
      const s = p.size[i] * (0.35 + k * 0.9);
      ctx.globalAlpha = k * k;
      ctx.drawImage(sprite, p.x[i] - s / 2, p.y[i] - s / 2, s, s);
    }
    ctx.restore();

    const fw = this.shardFrame;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < n; i++) {
      if (p.kind[i] !== SPLITTER) continue;
      const atlas = this.sprites.get(`splitter${p.color[i]}`);
      if (!atlas) continue;
      const k = p.life[i] / p.ttl[i];
      const s = p.size[i] * (0.6 + k * 0.6);
      // Drehwinkel auf eines der vorgebackenen Bilder abbilden
      let f = Math.floor((p.rot[i] / (Math.PI * 2)) * SHARD_FRAMES) % SHARD_FRAMES;
      if (f < 0) f += SHARD_FRAMES;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.drawImage(atlas, f * fw, 0, fw, fw, p.x[i] - s / 2, p.y[i] - s / 2, s, s);
    }
    ctx.restore();
  }

  /** Platzende Steine: Squash-Stretch über 120 ms. */
  drawPops(juice) {
    const dur = POP_MS / 1000;
    for (let i = 0; i < juice.popCount; i++) {
      const p = juice.pops[i];
      const t = Math.min(1, p.t / dur);
      const wobble = Math.sin(t * Math.PI * 2) * 0.38;
      const size = (1 - t) * (1 + 0.55 * Math.sin(t * Math.PI));
      this.drawStone(p.color, p.x, p.y, {
        alpha: 1 - t * t,
        scale: size,
        sx: 1 + wobble,
        sy: 1 - wobble,
      });
    }
  }

  // --- Hintergrund ----------------------------------------------------------

  drawBackground(biome) {
    const ctx = this.ctx;
    if (!this.bg || this.bgKey !== biome.key) this._bakeBackground(biome);
    // Der Hintergrund ist im exakten Bildschirmmaßstab gebacken und wird 1:1
    // gezeichnet — bilineare Filterung würde nur Rechenzeit kosten und nichts
    // verbessern. Sie abzuschalten spart auf dem Testgerät rund 4 ms je Bild,
    // weil hier ein bildschirmfüllendes Bild gefiltert würde.
    ctx.imageSmoothingEnabled = false;
    // Etwas größer als das Spielfeld, damit beim Screenshake kein Rand aufblitzt.
    ctx.drawImage(this.bg, -OVERSCAN, -OVERSCAN, VW + OVERSCAN * 2, VH + OVERSCAN * 2);
    ctx.imageSmoothingEnabled = true;
  }

  /**
   * Der Biom-Hintergrund wird genau einmal je Biom und Maßstab gebacken und
   * danach nur noch als fertiges Bild gezeichnet. Hier darf es also aufwendig
   * zugehen — die Kosten fallen beim Levelwechsel an, nicht pro Bild.
   *
   * Bildaufbau in fünf Schichten, immer in derselben Reihenfolge:
   *   Himmel -> Ferne (biomeigen) -> Beruhigungsschleier über dem Spielfeld
   *   -> Decke und Boden (biomeigen) -> Seitenwände, Hort, Vignette.
   * Der Schleier liegt bewusst zwischen Ferne und Vordergrund: Er nimmt der
   * Ferne den Kontrast, damit die Steine im Feld (y 56..1000) klar lesbar
   * bleiben, lässt Decke und Boden aber in voller Zeichnung stehen.
   */
  _bakeBackground(biome) {
    this.bgKey = biome.key;
    const s = this.spriteScale || 1;
    const W = VW + OVERSCAN * 2, H = VH + OVERSCAN * 2;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(W * s);
    cv.height = Math.ceil(H * s);
    const g = cv.getContext('2d');
    // Lokale Koordinaten = virtuelle Koordinaten; der Overscan liegt außerhalb.
    g.setTransform(s, 0, 0, s, OVERSCAN * s, OVERSCAN * s);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    const art = BIOME_ART[biome.key] || BIOME_ART.kristallhoehle;
    const rnd = seeded(hashKey(biome.key));

    bgSky(g, biome);
    art.far(g, biome, rnd);
    bgVeil(g, biome);
    bgDust(g, biome, rnd);
    art.ceiling(g, biome, rnd);
    art.floor(g, biome, rnd);
    bgWalls(g, biome);
    bgHoardBed(g, biome, rnd);
    bgVignette(g, biome);

    this.bg = cv;
  }

  // --- Spielfeld-Beiwerk ----------------------------------------------------

  drawFailLine(pulse = 0) {
    const ctx = this.ctx;
    ctx.save();
    // Warnschein unterhalb der Linie — wächst mit dem Puls
    if (pulse > 0.02) {
      const gl = ctx.createLinearGradient(0, FAIL_Y - 34, 0, FAIL_Y + 6);
      gl.addColorStop(0, 'rgba(255,70,100,0)');
      gl.addColorStop(1, `rgba(255,70,100,${0.16 * pulse})`);
      ctx.fillStyle = gl;
      ctx.fillRect(PLAY_LEFT, FAIL_Y - 34, PLAY_RIGHT - PLAY_LEFT, 40);
    }
    ctx.setLineDash([16, 14]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(255,90,110,${0.35 + pulse * 0.45})`;
    ctx.beginPath();
    ctx.moveTo(PLAY_LEFT, FAIL_Y);
    ctx.lineTo(PLAY_RIGHT, FAIL_Y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Flugbahn-Vorschau: gepunktete Linie mit genau einer Wandbande,
   * Punktabstand 24 px, nach hinten ausblendend, plus Geisterblase am Ziel.
   */
  drawPreview(trace, colorIndex, dim = false) {
    if (!trace || trace.points.length < 2) return;
    const ctx = this.ctx;
    const color = COLORS[colorIndex] || COLORS[0];

    // Endpunkt der Darstellung: nach der erlaubten Zahl Banden abschneiden.
    let limitIndex = trace.points.length - 1;
    if (trace.bounceAt.length > PREVIEW_MAX_BOUNCES) {
      limitIndex = trace.bounceAt[PREVIEW_MAX_BOUNCES];
    }

    let shown = 0;
    for (let i = 1; i <= limitIndex; i++) {
      shown += Math.hypot(
        trace.points[i].x - trace.points[i - 1].x,
        trace.points[i].y - trace.points[i - 1].y,
      );
    }

    ctx.save();
    const baseAlpha = dim ? 0.22 : 1;
    for (let d = PREVIEW_DOT_SPACING * 0.6; d < shown; d += PREVIEW_DOT_SPACING) {
      const p = pointOn(trace.points, d);
      const t = d / Math.max(shown, 1);
      const a = (1 - t * 0.85) * baseAlpha;
      const rad = 5.5 - t * 2.6;
      ctx.globalAlpha = a;
      ctx.fillStyle = color.light;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.4, rad), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Geisterblase auf dem errechneten Zielfeld
    if (trace.ghost) {
      this.drawStone(colorIndex, trace.ghost.x, trace.ghost.y, {
        alpha: dim ? 0.15 : 0.42,
        scale: 0.96,
      });
      const ctx2 = this.ctx;
      ctx2.save();
      ctx2.globalAlpha = dim ? 0.18 : 0.5;
      ctx2.strokeStyle = color.light;
      ctx2.lineWidth = 2;
      ctx2.setLineDash([6, 6]);
      ctx2.beginPath();
      ctx2.arc(trace.ghost.x, trace.ghost.y, R - 2, 0, Math.PI * 2);
      ctx2.stroke();
      ctx2.restore();
    }
  }

  // --- Drache ---------------------------------------------------------------

  /**
   * Der junge Kristalldrache besteht aus fünf vorgebackenen Ebenen, die pro
   * Bild nur noch gezeichnet werden: Flügel, Kopf mit Hals, Rumpf, Hortkante
   * und Glutkegel. Damit kostet der ganze Drache vier drawImage und zwei
   * Drehungen statt hundert Pfaden.
   */
  _bakeDragon() {
    dragonWings(this._newLayer('drWings', -252, -86, 504, 244));
    dragonHead(this._newLayer('drHead', -152, -96, 304, 240));
    dragonBody(this._newLayer('drBody', -190, 28, 380, 124));
    dragonHoard(this._newLayer('drHoard', -400, 84, 800, 66));
    dragonJet(this._newLayer('drJet', -56, -156, 112, 200));
    dragonMawGlow(this._newLayer('drGlow', -80, -80, 160, 160));
  }

  /**
   * @param {number} aimDeg  Zielwinkel in Grad, 0 = senkrecht nach oben
   * @param {number} charge  0..1, Glut im Maul (pulsiert im Bereitschaftszustand)
   * @param {number} recoil  1..0, Rückstoß direkt nach dem Schuss
   *
   * Der Kopf lehnt sich nur anteilig in die Zielrichtung — sonst kippt das
   * Gesicht bei 78° unleserlich weg. Die exakte Richtung zeigt der Glutkegel,
   * der vom Abschusspunkt (360, 1150) genau entlang der Zielachse austritt.
   * Gedreht wird um genau diesen Punkt: Der geladene Stein liegt dadurch bei
   * jedem Winkel im Maul, ohne sich je zu verschieben.
   */
  drawDragon(aimDeg, charge = 0, recoil = 0) {
    const ctx = this.ctx;
    const a = aimDeg * Math.PI / 180;
    const rx = -Math.sin(a) * recoil * RECOIL_PX;
    const ry = Math.cos(a) * recoil * RECOIL_PX;

    ctx.save();
    ctx.translate(SHOOTER_X, SHOOTER_Y);

    // Flügel folgen der Bewegung nur angedeutet
    ctx.save();
    ctx.rotate(a * WING_LEAN);
    ctx.translate(rx * 0.25, ry * 0.25);
    this._layer('drWings');
    ctx.restore();

    // Kopf samt Hals: kippt anteilig, fährt beim Rückstoß zurück
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(a * HEAD_LEAN);
    this._layer('drHead');
    ctx.restore();

    // Rumpf steht ruhig und deckt den Halsansatz in jeder Kopfstellung ab
    ctx.translate(rx * 0.18, ry * 0.18);
    this._layer('drBody');
    ctx.translate(-rx * 0.18, -ry * 0.18);
    this._layer('drHoard');

    // Glut im Maul — additiv, atmet mit dem Ladezustand
    if (charge > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, 0.35 + charge * 0.75);
      const k = 0.8 + charge * 0.5;
      const l = this.layers.get('drGlow');
      if (l) ctx.drawImage(l.cv, l.x * k, l.y * k, l.w * k, l.h * k);
      ctx.restore();
    }

    // Glutkegel exakt in Zielrichtung
    ctx.save();
    ctx.translate(rx * 0.5, ry * 0.5);
    ctx.rotate(a);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 + charge * 0.45;
    const j = this.layers.get('drJet');
    if (j) {
      const ky = 0.86 + charge * 0.3;
      ctx.drawImage(j.cv, j.x, j.y * ky, j.w, j.h * ky);
    }
    ctx.restore();

    ctx.restore();
  }

  // --- Kleinkram ------------------------------------------------------------

  text(str, x, y, {
    size = 24, color = '#e7dcff', align = 'left', baseline = 'alphabetic',
    weight = 600, shadow = true, alpha = 1,
  } = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    if (shadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(str, x + 2, y + 2);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  roundRect(x, y, w, h, r, fill, stroke = null, lw = 2) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
    ctx.restore();
  }

  overlay(color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(-OVERSCAN, -OVERSCAN, VW + OVERSCAN * 2, VH + OVERSCAN * 2);
    ctx.restore();
  }
}

// =============================================================================
//  Drache — Ebenen
// =============================================================================

/** Farbklaviatur des Drachen — nur diese acht Töne, sonst zerfällt die Figur. */
const DR = {
  scaleDark:  '#1b1140',   // Hals im Schatten
  scaleMid:   '#3d2792',   // Hals im Licht
  crystal:    '#cdb4ff',   // Hörner, Krause, Flügelstreben
  crystalHi:  '#f2e9ff',   // Kanten und Krallen
  eye:        '#ffd85e',
  eyeDeep:    '#7a3b00',
};

/**
 * Flügel: kräftiger Kristallarm als Vorderkante, dazwischen eine milchige
 * Membran mit ausgeschnittenen Bögen. Die Flügel liegen hinter allem anderen
 * und bleiben halbdurchsichtig — der Funkenregen aus dem Hort blitzt hindurch.
 */
function dragonWings(g) {
  for (const s of [-1, 1]) {
    const S  = [s * 34,  62];        // Schulter, dicht am Hals
    const E  = [s * 118, -8];        // Ellbogen
    const W  = [s * 198, -58];       // Handwurzel, der oberste Punkt
    const T1 = [s * 210, 14];        // Spitzen der Flughäute, von außen nach innen
    const T2 = [s * 166, 72];
    const T3 = [s * 104, 114];

    // Flughaut: ein großes Feld, hinten von drei Bögen ausgeschnitten.
    const mem = g.createLinearGradient(s * 40, 90, s * 190, -56);
    mem.addColorStop(0, 'rgba(28,14,72,0.92)');
    mem.addColorStop(0.45, 'rgba(58,36,134,0.86)');
    mem.addColorStop(1, 'rgba(108,84,196,0.78)');
    g.fillStyle = mem;
    g.beginPath();
    g.moveTo(S[0], S[1]);
    g.quadraticCurveTo(s * 76, 12, E[0], E[1]);
    g.quadraticCurveTo(s * 164, -42, W[0], W[1]);
    g.quadraticCurveTo(s * 218, -26, T1[0], T1[1]);
    g.quadraticCurveTo(s * 172, 30, T2[0], T2[1]);
    g.quadraticCurveTo(s * 126, 74, T3[0], T3[1]);
    g.quadraticCurveTo(s * 62, 96, S[0], S[1]);
    g.closePath();
    g.fill();

    // Adern in der Haut
    g.strokeStyle = 'rgba(180,158,255,0.18)';
    g.lineWidth = 2;
    for (const t of [T1, T2, T3]) {
      g.beginPath();
      g.moveTo(W[0], W[1]);
      g.quadraticCurveTo((W[0] + t[0]) / 2 + s * 12, (W[1] + t[1]) / 2, t[0] * 0.86, t[1] * 0.86);
      g.stroke();
    }

    // Finger: Kristallstreben, die die Haut aufspannen
    g.lineCap = 'round';
    for (const t of [T1, T2, T3]) {
      g.strokeStyle = 'rgba(198,182,240,0.7)';
      g.lineWidth = 4.5;
      g.beginPath();
      g.moveTo(W[0], W[1]);
      g.lineTo(t[0], t[1]);
      g.stroke();
      g.strokeStyle = 'rgba(30,14,78,0.6)';
      g.lineWidth = 1.6;
      g.stroke();
    }

    // Vorderkante: Oberarm und Unterarm
    g.strokeStyle = 'rgba(214,200,250,0.85)';
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(S[0], S[1]);
    g.quadraticCurveTo(s * 76, 12, E[0], E[1]);
    g.quadraticCurveTo(s * 164, -42, W[0], W[1]);
    g.stroke();
    g.strokeStyle = 'rgba(40,20,100,0.55)';
    g.lineWidth = 3.4;
    g.stroke();

    // Gelenkkristalle
    for (const p of [E, W]) {
      g.fillStyle = '#cbb8f4';
      g.beginPath();
      g.moveTo(p[0], p[1] - 11);
      g.lineTo(p[0] + s * 10, p[1]);
      g.lineTo(p[0], p[1] + 11);
      g.lineTo(p[0] - s * 10, p[1]);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(40,20,96,0.6)';
      g.lineWidth = 1.4;
      g.stroke();
    }

    // Daumenkralle am Bug
    g.fillStyle = '#d8caf8';
    g.beginPath();
    g.moveTo(W[0] - s * 4, W[1] - 4);
    g.quadraticCurveTo(W[0] + s * 16, W[1] - 30, W[0] + s * 28, W[1] - 36);
    g.quadraticCurveTo(W[0] + s * 12, W[1] - 10, W[0] + s * 8, W[1] + 12);
    g.closePath();
    g.fill();
  }
}

/**
 * Kopf und Hals.
 *
 * Der Nullpunkt ist die Mitte des Steins im Maul. Alles, was näher als 32 px
 * am Nullpunkt liegt, verschwindet später hinter diesem Stein — Augen, Zähne,
 * Nüstern und Lippen sitzen deshalb bewusst weiter außen, sonst wäre vom
 * Gesicht nichts zu sehen.
 */
function dragonHead(g) {
  // --- Hals (ganz hinten) --------------------------------------------------
  const neck = g.createLinearGradient(0, 46, 0, 140);
  neck.addColorStop(0, DR.scaleMid);
  neck.addColorStop(1, DR.scaleDark);
  g.fillStyle = neck;
  g.beginPath();
  g.moveTo(-52, 50);
  g.quadraticCurveTo(-66, 100, -72, 142);
  g.lineTo(72, 142);
  g.quadraticCurveTo(66, 100, 52, 50);
  g.closePath();
  g.fill();
  // Bauchschuppen des Halses — sie sind zwischen Kinn und Brust zu sehen
  g.fillStyle = 'rgba(255,208,132,0.5)';
  for (let i = 0; i < 4; i++) {
    const y = 80 + i * 15;
    const w = 24 + i * 6;
    g.beginPath();
    g.moveTo(-w, y);
    g.quadraticCurveTo(0, y + 12, w, y);
    g.quadraticCurveTo(0, y + 3, -w, y);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = 'rgba(16,6,42,0.6)';
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(-52, 50);
  g.quadraticCurveTo(-66, 100, -72, 142);
  g.moveTo(52, 50);
  g.quadraticCurveTo(66, 100, 72, 142);
  g.stroke();

  // --- Hörner (hinter dem Schädel) ----------------------------------------
  // Sie ragen über die Flügel hinaus und brauchen deshalb einen kräftigen
  // dunklen Rand — sonst gehen sie in der Flughaut dahinter verloren.
  for (const s of [-1, 1]) {
    const bx = s * 52, by = 4, tx = s * 116, ty = -66;
    const hg = g.createLinearGradient(bx, by + 20, tx, ty);
    hg.addColorStop(0, '#6d4fc0');
    hg.addColorStop(0.4, '#b9a2f4');
    hg.addColorStop(1, '#fbf7ff');
    g.fillStyle = hg;
    g.beginPath();
    g.moveTo(bx - s * 10, by + 30);
    g.quadraticCurveTo(s * 100, 6, tx, ty);
    g.quadraticCurveTo(s * 78, -20, bx + s * 22, by + 4);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(20,8,52,0.85)';
    g.lineWidth = 3;
    g.stroke();
    // Lichtkante an der Oberseite
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(bx + s * 18, by + 6);
    g.quadraticCurveTo(s * 80, -18, tx, ty);
    g.stroke();
    // Wachstumsringe
    g.strokeStyle = 'rgba(46,22,102,0.5)';
    g.lineWidth = 2.4;
    for (let i = 1; i <= 4; i++) {
      const t = i / 5.4;
      const x = bx + (tx - bx) * t;
      const y = by + 20 + (ty - by - 20) * t;
      g.beginPath();
      g.moveTo(x - s * 3, y + 14 - i * 2.6);
      g.lineTo(x + s * 18 - s * i * 3.4, y - 3);
      g.stroke();
    }
  }

  // Wangenfinnen als Bindeglied zwischen Kopf und Hals
  for (const s of [-1, 1]) {
    g.fillStyle = 'rgba(140,104,230,0.65)';
    g.beginPath();
    g.moveTo(s * 62, 22);
    g.quadraticCurveTo(s * 122, 16, s * 116, 52);
    g.quadraticCurveTo(s * 96, 46, s * 68, 64);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(222,206,255,0.5)';
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(s * 70, 28); g.lineTo(s * 108, 24);
    g.moveTo(s * 72, 40); g.lineTo(s * 106, 38);
    g.stroke();
  }

  // --- Rachen: dunkle Öffnung mit Glut, liegt hinter dem Stein -------------
  g.fillStyle = '#150929';
  g.beginPath();
  g.ellipse(0, -2, 52, 44, 0, 0, Math.PI * 2);
  g.fill();
  const throat = g.createRadialGradient(0, 8, 2, 0, 8, 50);
  throat.addColorStop(0, 'rgba(255,204,110,0.9)');
  throat.addColorStop(0.45, 'rgba(255,116,42,0.32)');
  throat.addColorStop(1, 'rgba(255,90,30,0)');
  g.fillStyle = throat;
  g.beginPath();
  g.ellipse(0, 4, 50, 42, 0, 0, Math.PI * 2);
  g.fill();

  // --- Schädel -------------------------------------------------------------
  // Breiter Keil mit V-förmiger Maulkerbe oben: darin sitzt der Stein.
  const skull = [
    [0, 80], [-26, 76], [-52, 60], [-70, 32], [-72, -2], [-62, -26],
    [-45, -50],                       // Oberkieferspitze links
    [-34, -22], [-20, 0], [0, 12],    // Innenlippe links -> Grund der Kerbe
    [20, 0], [34, -22],
    [45, -50],                        // Oberkieferspitze rechts
    [62, -26], [72, -2], [70, 32], [52, 60], [26, 76],
  ];
  const sg = g.createLinearGradient(0, -50, 0, 84);
  sg.addColorStop(0, '#e2d3ff');
  sg.addColorStop(0.3, '#a985f5');
  sg.addColorStop(0.66, '#5333b6');
  sg.addColorStop(1, '#221757');
  g.fillStyle = sg;
  poly(g, skull);
  g.fill();
  g.strokeStyle = 'rgba(22,9,50,0.7)';
  g.lineWidth = 2.6;
  g.stroke();

  // Facetten: Stirnplatte hell, Wangen dunkel, Kinnkeil hell
  g.fillStyle = 'rgba(255,255,255,0.17)';
  poly(g, [[-72, -2], [-30, 8], [0, 20], [30, 8], [72, -2], [64, 30], [0, 42], [-64, 30]]);
  g.fill();
  g.fillStyle = 'rgba(16,5,42,0.32)';
  poly(g, [[-64, 30], [0, 42], [64, 30], [52, 60], [26, 76], [0, 80], [-26, 76], [-52, 60]]);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.16)';
  poly(g, [[-24, 56], [0, 50], [24, 56], [16, 74], [0, 80], [-16, 74]]);
  g.fill();
  for (const s of [-1, 1]) {           // Schnauzenflanken fangen das Steinlicht
    g.fillStyle = 'rgba(255,255,255,0.22)';
    poly(g, [[s * 45, -50], [s * 72, -2], [s * 58, 10], [s * 34, -22]]);
    g.fill();
  }
  g.strokeStyle = 'rgba(230,218,255,0.32)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-72, -2); g.lineTo(-30, 8); g.lineTo(0, 20); g.lineTo(30, 8); g.lineTo(72, -2);
  g.moveTo(-64, 30); g.lineTo(0, 42); g.lineTo(64, 30);
  g.moveTo(-24, 56); g.lineTo(0, 50); g.lineTo(24, 56);
  g.stroke();

  // Zähne: rahmen den Stein von außen ein und machen aus der Kerbe ein Maul
  g.fillStyle = '#f8f4ff';
  g.strokeStyle = 'rgba(60,30,110,0.4)';
  g.lineWidth = 1.2;
  for (const s of [-1, 1]) {
    g.beginPath();                     // Langer Fang an der Lippenspitze
    g.moveTo(s * 43, -47);
    g.lineTo(s * 32, -12);
    g.lineTo(s * 56, -10);
    g.closePath();
    g.fill(); g.stroke();
    g.beginPath();                     // Zweiter Fang
    g.moveTo(s * 62, -8);
    g.lineTo(s * 50, 12);
    g.lineTo(s * 70, 10);
    g.closePath();
    g.fill(); g.stroke();
    g.beginPath();                     // Kleiner Backenzahn
    g.moveTo(s * 30, -20);
    g.lineTo(s * 24, -2);
    g.lineTo(s * 38, -2);
    g.closePath();
    g.fill(); g.stroke();
  }

  // Nüstern auf den Schnauzenflanken
  g.fillStyle = 'rgba(24,9,54,0.85)';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s * 55, -20, 5, 3.4, s * 0.55, 0, Math.PI * 2);
    g.fill();
  }

  // --- Augen ---------------------------------------------------------------
  for (const s of [-1, 1]) {
    // Brauenwulst aus Kristall
    g.fillStyle = '#9b7bee';
    g.beginPath();
    g.moveTo(s * 12, 20);
    g.lineTo(s * 66, 8);
    g.lineTo(s * 70, 26);
    g.lineTo(s * 16, 34);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(22,9,50,0.6)';
    g.lineWidth = 1.8;
    g.stroke();

    // Augapfel
    g.fillStyle = '#241146';
    g.beginPath();
    g.ellipse(s * 40, 44, 20, 16, s * 0.18, 0, Math.PI * 2);
    g.fill();
    const eg = g.createRadialGradient(s * 36, 39, 1, s * 40, 44, 17);
    eg.addColorStop(0, '#fff6d2');
    eg.addColorStop(0.5, DR.eye);
    eg.addColorStop(1, DR.eyeDeep);
    g.fillStyle = eg;
    g.beginPath();
    g.ellipse(s * 40, 44, 16, 12.5, s * 0.18, 0, Math.PI * 2);
    g.fill();
    // Schlitzpupille
    g.fillStyle = '#190834';
    g.beginPath();
    g.ellipse(s * 40, 44, 4, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath();
    g.arc(s * 45, 38, 3.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.beginPath();
    g.arc(s * 33, 50, 1.8, 0, Math.PI * 2);
    g.fill();
  }

  // --- Halskrause: Kristallplatten seitlich an der Kieferlinie -------------
  // Sie markiert den Übergang Kopf -> Hals. Unter dem Kinn bleibt sie offen,
  // dort schaut die helle Kehle des Halses hervor.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const x = s * (46 + i * 20);
      const y = 74 - i * 12;
      const w = 12 - i * 1.5;
      g.fillStyle = i === 1 ? '#8f6fe4' : '#a184ee';
      g.beginPath();
      g.moveTo(x - s * w, y - 12);
      g.lineTo(x + s * w, y - 16);
      g.lineTo(x + s * (w + 10), y + 12);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(22,9,52,0.65)';
      g.lineWidth = 1.6;
      g.stroke();
      g.strokeStyle = 'rgba(228,214,255,0.4)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x + s * w, y - 16);
      g.lineTo(x + s * (w + 10), y + 12);
      g.stroke();
    }
  }

  // Silhouette nachziehen: erst eine dunkle Kontur, die den Kopf vom Körper
  // trennt, darüber ein schmaler Lichtsaum.
  g.strokeStyle = 'rgba(14,5,38,0.75)';
  g.lineWidth = 3.4;
  poly(g, skull);
  g.stroke();
  g.strokeStyle = 'rgba(226,212,255,0.5)';
  g.lineWidth = 1.6;
  poly(g, skull);
  g.stroke();
}

/**
 * Rumpf: zwei breite Schulterberge links und rechts des Halses, dazwischen
 * eine Mulde — dadurch bleibt der Hals sichtbar und Kopf, Hals und Körper
 * lesen sich als drei getrennte Formen.
 */
function dragonBody(g) {
  // Zwei Schulterberge mit einer Mulde in der Mitte: dadurch bleibt zwischen
  // Kinn und Brust ein Stück Hals sichtbar, und Kopf, Hals und Körper lesen
  // sich als drei getrennte Formen.
  const torso = [
    [-176, 152], [-166, 116], [-140, 78], [-104, 52], [-70, 46],
    [-40, 74], [0, 106], [40, 74], [70, 46],
    [104, 52], [140, 78], [166, 116], [176, 152],
  ];
  const bg = g.createLinearGradient(0, 44, 0, 152);
  bg.addColorStop(0, '#5c3cc4');
  bg.addColorStop(0.4, '#332183');
  bg.addColorStop(1, '#150c33');
  g.fillStyle = bg;
  poly(g, torso);
  g.fill();
  g.strokeStyle = 'rgba(18,7,44,0.8)';
  g.lineWidth = 2.6;
  g.stroke();

  // Brustplatte in warmem Ton
  const belly = g.createLinearGradient(0, 74, 0, 152);
  belly.addColorStop(0, 'rgba(255,206,128,0.4)');
  belly.addColorStop(1, 'rgba(255,144,56,0.1)');
  g.fillStyle = belly;
  g.beginPath();
  g.moveTo(-56, 92);
  g.quadraticCurveTo(0, 68, 56, 92);
  g.quadraticCurveTo(62, 130, 44, 152);
  g.lineTo(-44, 152);
  g.quadraticCurveTo(-62, 130, -56, 92);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(255,222,168,0.32)';
  g.lineWidth = 1.8;
  for (let i = 0; i < 3; i++) {
    const y = 98 + i * 18;
    const w = 48 + i * 3;
    g.beginPath();
    g.moveTo(-w, y);
    g.quadraticCurveTo(0, y + 15, w, y);
    g.stroke();
  }

  // Innere Glut — der Funke selbst
  g.save();
  g.globalCompositeOperation = 'lighter';
  const fire = g.createRadialGradient(0, 118, 4, 0, 118, 70);
  fire.addColorStop(0, 'rgba(255,186,88,0.4)');
  fire.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = fire;
  g.beginPath();
  g.ellipse(0, 118, 66, 54, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Schulterkristalle und Klauen
  for (const s of [-1, 1]) {
    const cg = g.createLinearGradient(s * 92, 46, s * 124, 104);
    cg.addColorStop(0, '#9d81e4');
    cg.addColorStop(1, '#3f2896');
    g.fillStyle = cg;
    g.beginPath();
    g.moveTo(s * 82, 76);
    g.lineTo(s * 106, 48);
    g.lineTo(s * 130, 78);
    g.lineTo(s * 114, 106);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(18,7,44,0.7)';
    g.lineWidth = 2;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(s * 106, 48); g.lineTo(s * 107, 96);
    g.stroke();

    // Schuppenreihe auf der Schulter
    g.fillStyle = 'rgba(200,178,255,0.28)';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.ellipse(s * (66 + i * 22), 92 + i * 14, 13, 9, s * 0.5, 0, Math.PI * 2);
      g.fill();
    }

    // Vorderklaue, im Hort abgestützt
    g.fillStyle = '#241562';
    g.beginPath();
    g.moveTo(s * 84, 108);
    g.quadraticCurveTo(s * 128, 118, s * 134, 152);
    g.lineTo(s * 72, 152);
    g.closePath();
    g.fill();
    g.fillStyle = DR.crystalHi;
    for (let i = 0; i < 3; i++) {
      const x = s * (88 + i * 17);
      g.beginPath();
      g.moveTo(x, 140);
      g.lineTo(x + s * 11, 135);
      g.lineTo(x + s * 4, 154);
      g.closePath();
      g.fill();
    }
  }
}

/**
 * Vordere Hortkante: der Drache sitzt in seinem Schatz. Bewusst dunkel
 * gehalten — der Hort ist Rahmen, nicht Blickfang, und darf die Punkteanzeige
 * darüber nicht anfressen.
 */
function dragonHoard(g) {
  const rnd = seeded(20240711);
  const top = 106;
  const wall = g.createLinearGradient(0, top - 10, 0, 152);
  wall.addColorStop(0, '#3a2a10');
  wall.addColorStop(0.45, '#1d1408');
  wall.addColorStop(1, '#0b0704');
  g.fillStyle = wall;
  g.beginPath();
  g.moveTo(-400, 152);
  g.lineTo(-400, top + 12);
  for (let x = -400; x <= 400; x += 52) {
    g.quadraticCurveTo(x + 26, top - 4 - rnd() * 12, x + 52, top + 8 - rnd() * 8);
  }
  g.lineTo(400, 152);
  g.closePath();
  g.fill();

  // Wenige Glanzlichter auf der Kante — Münzen, die das Drachenfeuer fangen
  for (let i = 0; i < 46; i++) {
    const x = -400 + rnd() * 800;
    const y = top + 4 + rnd() * 40;
    const r = 3.5 + rnd() * 5;
    const near = Math.max(0, 1 - Math.abs(x) / 340);
    g.fillStyle = rnd() > 0.8
      ? `rgba(190,160,255,${0.18 + near * 0.26})`
      : `rgba(230,180,80,${0.16 + near * 0.3})`;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.58, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }

  // Lichtsaum auf der Oberkante
  const rnd2 = seeded(20240711);
  g.strokeStyle = 'rgba(255,206,132,0.28)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-400, top + 12);
  for (let x = -400; x <= 400; x += 52) {
    g.quadraticCurveTo(x + 26, top - 4 - rnd2() * 12, x + 52, top + 8 - rnd2() * 8);
  }
  g.stroke();
}

/**
 * Glutkegel: zeigt exakt in Zielrichtung. Der helle Kern liegt innerhalb von
 * 32 px um den Nullpunkt und damit hinter dem geladenen Stein — sichtbar ist
 * nur der weiche Schweif, der am Stein vorbeizüngelt.
 */
function dragonJet(g) {
  // Weicher Schweif
  const core = g.createLinearGradient(0, 20, 0, -150);
  core.addColorStop(0, 'rgba(255,238,196,0.55)');
  core.addColorStop(0.14, 'rgba(255,206,116,0.34)');
  core.addColorStop(0.45, 'rgba(255,140,58,0.14)');
  core.addColorStop(1, 'rgba(255,96,32,0)');
  g.fillStyle = core;
  g.beginPath();
  g.moveTo(-30, 24);
  g.quadraticCurveTo(-26, -60, 0, -150);
  g.quadraticCurveTo(26, -60, 30, 24);
  g.quadraticCurveTo(0, 40, -30, 24);
  g.closePath();
  g.fill();

  // Zwei schmale Zungen geben dem Kegel Struktur
  g.fillStyle = 'rgba(255,232,168,0.14)';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(s * 15, 16);
    g.quadraticCurveTo(s * 20, -56, s * 6, -114);
    g.quadraticCurveTo(s * 3, -54, s * 4, 16);
    g.closePath();
    g.fill();
  }

  // Funkenflug
  const rnd = seeded(4711);
  for (let i = 0; i < 26; i++) {
    const t = rnd();
    const y = 8 - t * 140;
    const spread = 24 * (1 - t * 0.72);
    const x = (rnd() * 2 - 1) * spread;
    const r = 1 + rnd() * 2.4;
    g.fillStyle = `rgba(255,${190 + rnd() * 60 | 0},130,${0.42 - t * 0.34})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

/** Warmer Schein rund um den Stein im Maul. */
function dragonMawGlow(g) {
  const gl = g.createRadialGradient(0, 0, 10, 0, 0, 78);
  gl.addColorStop(0, 'rgba(255,224,156,0.5)');
  gl.addColorStop(0.4, 'rgba(255,158,70,0.2)');
  gl.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gl;
  g.beginPath();
  g.arc(0, 0, 78, 0, Math.PI * 2);
  g.fill();
}

// =============================================================================
//  Hintergrund — gemeinsame Schichten
// =============================================================================

function bgSky(g, biome) {
  const sky = g.createLinearGradient(0, -OVERSCAN, 0, VH + OVERSCAN);
  sky.addColorStop(0, biome.sky[0]);
  sky.addColorStop(0.42, mix(biome.sky[0], biome.sky[1], 0.55));
  sky.addColorStop(0.8, biome.sky[1]);
  sky.addColorStop(1, mix(biome.sky[1], '#000000', 0.35));
  g.fillStyle = sky;
  g.fillRect(-OVERSCAN, -OVERSCAN, VW + OVERSCAN * 2, VH + OVERSCAN * 2);

  // Schein aus dem Hort herauf — gibt dem Bild einen Fluchtpunkt
  const gl = g.createRadialGradient(VW / 2, VH - 120, 20, VW / 2, VH - 120, 480);
  gl.addColorStop(0, hexA(biome.glow, 0.20));
  gl.addColorStop(0.5, hexA(biome.glow, 0.07));
  gl.addColorStop(1, hexA(biome.glow, 0));
  g.fillStyle = gl;
  g.fillRect(-OVERSCAN, VH - 620, VW + OVERSCAN * 2, 620 + OVERSCAN);
}

/**
 * Beruhigungsschleier über dem Spielfeld. Die Ferne darf Bildsprache haben,
 * aber die Steine müssen dagegen stehen können — hier wird der Kontrast der
 * hinteren Schicht im Bereich y 40..1010 zurückgenommen.
 */
function bgVeil(g, biome) {
  const veil = g.createLinearGradient(0, CEILING_Y - 30, 0, FAIL_Y + 60);
  veil.addColorStop(0, 'rgba(5,2,14,0.72)');
  veil.addColorStop(0.14, 'rgba(5,2,14,0.55)');
  veil.addColorStop(0.75, 'rgba(5,2,14,0.42)');
  veil.addColorStop(1, 'rgba(5,2,14,0)');
  g.fillStyle = veil;
  g.fillRect(-OVERSCAN, CEILING_Y - 30, VW + OVERSCAN * 2, FAIL_Y + 90 - CEILING_Y);
  // ganz oben zusätzlich abdunkeln: dort steht der Biomname
  const top = g.createLinearGradient(0, -OVERSCAN, 0, 150);
  top.addColorStop(0, 'rgba(4,2,12,0.5)');
  top.addColorStop(1, 'rgba(4,2,12,0)');
  g.fillStyle = top;
  g.fillRect(-OVERSCAN, -OVERSCAN, VW + OVERSCAN * 2, 170);
}

/**
 * Staub im Lichtkegel: winzige Punkte über dem beruhigten Spielfeld. Sie
 * nehmen der leeren Mitte die Leblosigkeit, bleiben aber so schwach, dass die
 * Steine ungestört davor stehen.
 */
function bgDust(g, biome, rnd) {
  for (let i = 0; i < 90; i++) {
    const x = 10 + rnd() * (VW - 20);
    const y = 90 + rnd() * 1000;
    const r = 0.7 + rnd() * 1.9;
    // Unten heller — dort steigt der Schein aus dem Hort auf.
    const depth = 0.05 + 0.14 * (y / VH) ** 2;
    g.fillStyle = hexA(biome.glow, depth * (0.5 + rnd()));
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

function bgWalls(g, biome) {
  const dark = mix(biome.rock, '#000000', 0.45);
  for (const [x0, w] of [[-OVERSCAN, PLAY_LEFT + OVERSCAN], [PLAY_RIGHT, VW - PLAY_RIGHT + OVERSCAN]]) {
    const wg = g.createLinearGradient(x0, 0, x0 + w, 0);
    wg.addColorStop(0, dark);
    wg.addColorStop(1, mix(biome.rock, '#000000', 0.15));
    g.fillStyle = x0 < 0 ? wg : dark;
    g.fillRect(x0, -OVERSCAN, w, VH + OVERSCAN * 2);
  }
  // Leuchtschiene an der Bandenkante
  g.strokeStyle = hexA(biome.glow, 0.42);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(PLAY_LEFT, CEILING_Y); g.lineTo(PLAY_LEFT, VH);
  g.moveTo(PLAY_RIGHT, CEILING_Y); g.lineTo(PLAY_RIGHT, VH);
  g.stroke();
  g.strokeStyle = hexA(biome.glow, 0.14);
  g.lineWidth = 6;
  g.stroke();
}

/** Hortbett: der Schatz, in dem der Drache sitzt — hinter dem Drachen. */
function bgHoardBed(g, biome, rnd) {
  // Die Kante liegt knapp unter der Höhe, in der abgestürzte Steine im Hort
  // versinken (HOARD_Y) — dort setzt der Funkenregen auf.
  const top = HOARD_Y - 8;
  const bed = g.createLinearGradient(0, top - 30, 0, VH + OVERSCAN);
  bed.addColorStop(0, 'rgba(10,5,20,0)');
  bed.addColorStop(0.35, 'rgba(12,6,22,0.6)');
  bed.addColorStop(1, 'rgba(6,3,14,0.92)');
  g.fillStyle = bed;
  g.fillRect(-OVERSCAN, top - 30, VW + OVERSCAN * 2, VH - top + 30 + OVERSCAN);

  // Wallkante
  g.fillStyle = 'rgba(40,27,10,0.9)';
  g.beginPath();
  g.moveTo(-OVERSCAN, VH + OVERSCAN);
  g.lineTo(-OVERSCAN, top + 18);
  for (let x = -OVERSCAN; x <= VW + OVERSCAN; x += 46) {
    g.quadraticCurveTo(x + 23, top - 6 - rnd() * 14, x + 46, top + 8 - rnd() * 10);
  }
  g.lineTo(VW + OVERSCAN, VH + OVERSCAN);
  g.closePath();
  g.fill();

  // Verstreute Münzen, sehr gedämpft — Drache und Vordergrundkante liefern
  // die kräftigen Lichter.
  for (let i = 0; i < 54; i++) {
    const x = -OVERSCAN + rnd() * (VW + OVERSCAN * 2);
    const y = top + rnd() * 66;
    const r = 3 + rnd() * 4.5;
    g.fillStyle = `rgba(${170 + rnd() * 60 | 0},${120 + rnd() * 60 | 0},${50 + rnd() * 40 | 0},${0.2 + rnd() * 0.3})`;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.6, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // Schein des Schatzes
  const gl = g.createRadialGradient(VW / 2, HOARD_Y + 20, 20, VW / 2, HOARD_Y + 20, 320);
  gl.addColorStop(0, 'rgba(255,190,90,0.14)');
  gl.addColorStop(1, 'rgba(255,150,60,0)');
  g.fillStyle = gl;
  g.fillRect(-OVERSCAN, top - 90, VW + OVERSCAN * 2, VH - top + 90 + OVERSCAN);
}

function bgVignette(g) {
  const v = g.createRadialGradient(VW / 2, VH * 0.46, VW * 0.34, VW / 2, VH * 0.46, VH * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = v;
  g.fillRect(-OVERSCAN, -OVERSCAN, VW + OVERSCAN * 2, VH + OVERSCAN * 2);
  // Ruhezone für den HUD-Text unten
  const hud = g.createLinearGradient(0, FAIL_Y - 6, 0, 1080);
  hud.addColorStop(0, 'rgba(6,3,16,0)');
  hud.addColorStop(0.5, 'rgba(6,3,16,0.55)');
  hud.addColorStop(1, 'rgba(6,3,16,0.2)');
  g.fillStyle = hud;
  g.fillRect(-OVERSCAN, FAIL_Y - 6, VW + OVERSCAN * 2, 92);
}

/** Deckenband 0..56 als Fels, mit zackiger Unterkante. */
function ceilingSlab(g, biome, rnd, teeth = 26, depth = 12) {
  const rock = g.createLinearGradient(0, -OVERSCAN, 0, CEILING_Y + 6);
  rock.addColorStop(0, mix(biome.rock, '#000000', 0.7));
  rock.addColorStop(0.55, mix(biome.rock, '#000000', 0.25));
  rock.addColorStop(1, biome.rock);
  g.fillStyle = rock;
  g.beginPath();
  g.moveTo(-OVERSCAN, -OVERSCAN);
  g.lineTo(VW + OVERSCAN, -OVERSCAN);
  g.lineTo(VW + OVERSCAN, CEILING_Y - 2);
  for (let i = teeth; i >= 0; i--) {
    const x = -OVERSCAN + (i / teeth) * (VW + OVERSCAN * 2);
    g.lineTo(x, CEILING_Y - (i % 2 === 0 ? 0 : 4 + rnd() * depth));
  }
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  g.stroke();
}

// =============================================================================
//  Hintergrund — die fünf Biome
// =============================================================================

/** Faceted crystal spire, von unten nach oben. */
function spire(g, x, base, w, h, cLight, cDark, edge = 0.3) {
  const gr = g.createLinearGradient(x - w, base, x + w * 0.6, base - h);
  gr.addColorStop(0, cDark);
  gr.addColorStop(0.6, mix(cDark, cLight, 0.45));
  gr.addColorStop(1, cLight);
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(x - w, base);
  g.lineTo(x - w * 0.5, base - h * 0.72);
  g.lineTo(x, base - h);
  g.lineTo(x + w * 0.62, base - h * 0.6);
  g.lineTo(x + w, base);
  g.closePath();
  g.fill();
  // Mittelgrat
  g.fillStyle = `rgba(255,255,255,${edge * 0.4})`;
  g.beginPath();
  g.moveTo(x, base - h);
  g.lineTo(x + w * 0.62, base - h * 0.6);
  g.lineTo(x + w * 0.3, base);
  g.lineTo(x, base);
  g.closePath();
  g.fill();
  g.strokeStyle = `rgba(255,255,255,${edge})`;
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(x - w * 0.5, base - h * 0.72);
  g.lineTo(x, base - h);
  g.lineTo(x + w * 0.62, base - h * 0.6);
  g.stroke();
}

const BIOME_ART = {
  // --- Kristallhöhle -------------------------------------------------------
  kristallhoehle: {
    far(g, b, rnd) {
      // Ferne Kristallwälder, von unten in die Höhe wachsend
      for (let i = 0; i < 16; i++) {
        const x = rnd() * VW;
        const h = 180 + rnd() * 420;
        const w = 26 + rnd() * 54;
        g.fillStyle = hexA(mix(b.rock, b.glow, 0.25), 0.4 + rnd() * 0.2);
        g.beginPath();
        g.moveTo(x - w, VH - 120);
        g.lineTo(x - w * 0.4, VH - 120 - h * 0.75);
        g.lineTo(x + rnd() * 10, VH - 120 - h);
        g.lineTo(x + w * 0.6, VH - 120 - h * 0.55);
        g.lineTo(x + w, VH - 120);
        g.closePath();
        g.fill();
      }
      // Geoden-Adern, nur im unteren Drittel — im Spielfeld würden sie stören
      g.strokeStyle = hexA(b.glow, 0.13);
      for (let i = 0; i < 5; i++) {
        const y = 980 + rnd() * 240;
        g.lineWidth = 1 + rnd() * 2;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= VW; x += 60) g.lineTo(x, y + (rnd() - 0.5) * 34);
        g.stroke();
      }
    },
    ceiling(g, b, rnd) {
      ceilingSlab(g, b, rnd, 26, 14);
      // Stalaktiten und eingewachsene Kristalle
      for (let i = 0; i < 26; i++) {
        const x = -10 + rnd() * (VW + 20);
        const h = 16 + rnd() * 58;
        const w = 5 + rnd() * 13;
        const gr = g.createLinearGradient(x, CEILING_Y - 20, x, CEILING_Y + h);
        gr.addColorStop(0, mix(b.rock, '#ffffff', 0.18));
        gr.addColorStop(1, mix(b.rock, '#000000', 0.6));
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(x - w, CEILING_Y - 16);
        g.lineTo(x + w, CEILING_Y - 16);
        g.lineTo(x + w * 0.2, CEILING_Y + h);
        g.closePath();
        g.fill();
        if (rnd() > 0.66) {
          g.fillStyle = hexA(b.glow, 0.55);
          g.beginPath();
          g.arc(x + w * 0.2, CEILING_Y + h - 3, 2.4 + rnd() * 2, 0, Math.PI * 2);
          g.fill();
        }
      }
      // Kristalldrusen in der Decke
      for (let i = 0; i < 14; i++) {
        const x = 30 + rnd() * (VW - 60);
        const y = 6 + rnd() * 34;
        const s = 5 + rnd() * 10;
        g.fillStyle = hexA(b.glow, 0.25 + rnd() * 0.3);
        g.beginPath();
        g.moveTo(x, y - s);
        g.lineTo(x + s * 0.6, y);
        g.lineTo(x, y + s);
        g.lineTo(x - s * 0.6, y);
        g.closePath();
        g.fill();
      }
    },
    floor(g, b, rnd) {
      // Kristallzacken links und rechts vom Drachen. Die Spitzen liegen
      // zwischen HUD-Text (bis y 1066) und Hortkante — dort ist Platz.
      const set = [
        [42, 246, 66], [112, 176, 44], [176, 118, 32],
        [548, 196, 50], [630, 262, 62], [694, 146, 40],
        [246, 92, 26], [468, 104, 28],
      ];
      for (const [x, h, w] of set) {
        spire(g, x, VH - 24, w, h, mix(b.glow, '#ffffff', 0.35), mix(b.rock, '#000000', 0.35), 0.34);
      }
      // Leuchtende Kristallbüschel am Boden
      for (let i = 0; i < 20; i++) {
        const x = rnd() * VW;
        const h = 18 + rnd() * 46;
        const base = 1196 + rnd() * 20;
        g.fillStyle = hexA(b.glow, 0.28 + rnd() * 0.25);
        g.beginPath();
        g.moveTo(x - 8, base);
        g.lineTo(x, base - h);
        g.lineTo(x + 8, base);
        g.closePath();
        g.fill();
      }
    },
  },

  // --- Pilzwald ------------------------------------------------------------
  pilzwald: {
    far(g, b, rnd) {
      // Riesenpilze als Silhouette
      for (let i = 0; i < 9; i++) {
        const x = rnd() * VW;
        const y = 560 + rnd() * 420;
        const s = 60 + rnd() * 120;
        g.fillStyle = hexA(mix(b.rock, b.glow, 0.2), 0.45);
        g.beginPath();
        g.ellipse(x, y, s, s * 0.5, 0, Math.PI, 0);
        g.closePath();
        g.fill();
        g.fillRect(x - s * 0.13, y, s * 0.26, 260);
      }
      // Sporenlicht
      for (let i = 0; i < 120; i++) {
        const x = rnd() * VW, y = 120 + rnd() * 900;
        const r = 1 + rnd() * 3;
        g.fillStyle = hexA(b.glow, 0.1 + rnd() * 0.3);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    },
    ceiling(g, b, rnd) {
      ceilingSlab(g, b, rnd, 20, 10);
      // Wurzeln und Ranken hängen herab
      g.strokeStyle = mix(b.rock, '#000000', 0.4);
      for (let i = 0; i < 22; i++) {
        const x = -10 + rnd() * (VW + 20);
        const h = 20 + rnd() * 66;
        g.lineWidth = 2 + rnd() * 4;
        g.beginPath();
        g.moveTo(x, CEILING_Y - 14);
        g.quadraticCurveTo(x + (rnd() - 0.5) * 26, CEILING_Y + h * 0.6, x + (rnd() - 0.5) * 20, CEILING_Y + h);
        g.stroke();
      }
      // Moos und kleine Leuchtpilze an der Decke
      for (let i = 0; i < 22; i++) {
        const x = 12 + rnd() * (VW - 24);
        const y = CEILING_Y - 6 - rnd() * 12;
        const s = 5 + rnd() * 11;
        g.fillStyle = hexA(b.glow, 0.35 + rnd() * 0.3);
        g.beginPath();
        g.ellipse(x, y, s, s * 0.62, 0, Math.PI, 0);
        g.closePath();
        g.fill();
        g.fillStyle = 'rgba(220,255,235,0.25)';
        g.fillRect(x - 1.4, y, 2.8, 8);
      }
      g.fillStyle = hexA(b.glow, 0.12);
      g.fillRect(-OVERSCAN, CEILING_Y - 3, VW + OVERSCAN * 2, 3);
    },
    floor(g, b, rnd) {
      // Pilzgruppe im Vordergrund
      const caps = [
        [64, VH - 168, 80], [148, VH - 116, 48], [18, VH - 104, 42],
        [556, VH - 122, 54], [652, VH - 176, 86], [704, VH - 100, 38],
        [232, VH - 92, 34], [484, VH - 96, 36],
      ];
      for (const [x, y, s] of caps) {
        // Stiel
        g.fillStyle = 'rgba(224,236,214,0.5)';
        g.beginPath();
        g.moveTo(x - s * 0.14, y);
        g.quadraticCurveTo(x - s * 0.2, y + 80, x - s * 0.24, VH);
        g.lineTo(x + s * 0.24, VH);
        g.quadraticCurveTo(x + s * 0.2, y + 80, x + s * 0.14, y);
        g.closePath();
        g.fill();
        // Lamellen
        g.strokeStyle = 'rgba(180,220,190,0.35)';
        g.lineWidth = 1.4;
        for (let k = -3; k <= 3; k++) {
          g.beginPath();
          g.moveTo(x, y + 2);
          g.lineTo(x + (k / 3) * s * 0.8, y + 12);
          g.stroke();
        }
        // Hut
        const cg = g.createLinearGradient(x, y - s * 0.7, x, y + 6);
        cg.addColorStop(0, mix(b.glow, '#ffffff', 0.5));
        cg.addColorStop(0.6, b.glow);
        cg.addColorStop(1, mix(b.glow, '#000000', 0.55));
        g.fillStyle = cg;
        g.beginPath();
        g.ellipse(x, y, s, s * 0.66, 0, Math.PI, 0);
        g.closePath();
        g.fill();
        // Tupfen
        g.fillStyle = 'rgba(255,255,255,0.4)';
        for (let k = 0; k < 5; k++) {
          const a = Math.PI + 0.35 + rnd() * (Math.PI - 0.7);
          const rr = s * (0.3 + rnd() * 0.5);
          g.beginPath();
          g.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.66, 2 + rnd() * 3.5, 0, Math.PI * 2);
          g.fill();
        }
        // Schein unter dem Hut
        const ug = g.createRadialGradient(x, y, 2, x, y, s * 1.5);
        ug.addColorStop(0, hexA(b.glow, 0.3));
        ug.addColorStop(1, hexA(b.glow, 0));
        g.fillStyle = ug;
        g.beginPath();
        g.arc(x, y, s * 1.5, 0, Math.PI * 2);
        g.fill();
      }
      // Moosteppich
      g.fillStyle = hexA(mix(b.rock, b.glow, 0.35), 0.42);
      g.beginPath();
      g.moveTo(-OVERSCAN, VH + OVERSCAN);
      g.lineTo(-OVERSCAN, VH - 76);
      for (let x = -OVERSCAN; x < VW + OVERSCAN; x += 34) {
        g.quadraticCurveTo(x + 17, VH - 96 - rnd() * 18, x + 34, VH - 78);
      }
      g.lineTo(VW + OVERSCAN, VH + OVERSCAN);
      g.closePath();
      g.fill();
    },
  },

  // --- Lavaschmiede --------------------------------------------------------
  lavaschmiede: {
    far(g, b, rnd) {
      // Schlackekegel und Essen im Hintergrund
      for (let i = 0; i < 8; i++) {
        const x = rnd() * VW;
        const h = 160 + rnd() * 260;
        const w = 70 + rnd() * 110;
        g.fillStyle = hexA(mix(b.rock, '#000000', 0.45), 0.75);
        g.beginPath();
        g.moveTo(x - w, VH - 150);
        g.lineTo(x - w * 0.2, VH - 150 - h);
        g.lineTo(x + w * 0.2, VH - 150 - h);
        g.lineTo(x + w, VH - 150);
        g.closePath();
        g.fill();
        g.fillStyle = hexA(b.glow, 0.35);
        g.fillRect(x - w * 0.2, VH - 152 - h, w * 0.4, 5);
      }
      // Glutrisse in der Rückwand
      for (let i = 0; i < 14; i++) {
        crack(g, rnd() * VW, 160 + rnd() * 800, 60 + rnd() * 180, b.glow, 0.22, rnd);
      }
      // Heiße Luft
      const heat = g.createLinearGradient(0, VH - 420, 0, VH);
      heat.addColorStop(0, hexA(b.glow, 0));
      heat.addColorStop(1, hexA(b.glow, 0.22));
      g.fillStyle = heat;
      g.fillRect(-OVERSCAN, VH - 420, VW + OVERSCAN * 2, 420 + OVERSCAN);
    },
    ceiling(g, b, rnd) {
      ceilingSlab(g, b, rnd, 24, 12);
      // Rußige Decke mit Glutrissen
      for (let i = 0; i < 10; i++) {
        crack(g, 20 + rnd() * (VW - 40), 8 + rnd() * 40, 26 + rnd() * 70, b.glow, 0.6, rnd);
      }
      // Ketten mit Haken
      for (const x of [128, 268, 452, 596]) {
        g.strokeStyle = 'rgba(190,150,130,0.4)';
        g.lineWidth = 2.4;
        const h = 30 + (x % 37);
        g.beginPath();
        for (let k = 0; k < 7; k++) {
          const y = CEILING_Y - 12 + k * (h / 7);
          g.moveTo(x - 3, y);
          g.lineTo(x + 3, y + h / 12);
        }
        g.stroke();
        g.beginPath();
        g.arc(x, CEILING_Y - 12 + h + 5, 5, Math.PI * 0.2, Math.PI * 1.5);
        g.stroke();
      }
      // Tropfende Schlacke
      for (let i = 0; i < 12; i++) {
        const x = rnd() * VW;
        const h = 8 + rnd() * 26;
        g.fillStyle = hexA(b.glow, 0.35 + rnd() * 0.3);
        g.beginPath();
        g.moveTo(x - 3, CEILING_Y - 8);
        g.lineTo(x + 3, CEILING_Y - 8);
        g.lineTo(x, CEILING_Y + h);
        g.closePath();
        g.fill();
      }
    },
    floor(g, b, rnd) {
      // Amboss auf Steinblock
      const anvil = (x, y, s) => {
        // Glutschein hinter dem Amboss, damit die Silhouette überhaupt steht
        const halo = g.createRadialGradient(x, y - 30 * s, 4, x, y - 30 * s, 120 * s);
        halo.addColorStop(0, hexA(b.glow, 0.3));
        halo.addColorStop(1, hexA(b.glow, 0));
        g.fillStyle = halo;
        g.beginPath();
        g.arc(x, y - 30 * s, 120 * s, 0, Math.PI * 2);
        g.fill();

        g.fillStyle = '#3d241b';
        g.fillRect(x - 26 * s, y, 52 * s, 52 * s);
        g.fillStyle = '#26150f';
        g.beginPath();
        g.moveTo(x - 36 * s, y);
        g.lineTo(x + 36 * s, y);
        g.lineTo(x + 26 * s, y - 11 * s);
        g.lineTo(x - 26 * s, y - 11 * s);
        g.closePath();
        g.fill();
        // Körper
        g.fillStyle = '#33201a';
        g.beginPath();
        g.moveTo(x - 15 * s, y - 11 * s);
        g.lineTo(x + 15 * s, y - 11 * s);
        g.lineTo(x + 19 * s, y - 32 * s);
        g.lineTo(x - 19 * s, y - 32 * s);
        g.closePath();
        g.fill();
        // Bahn mit Horn
        g.fillStyle = '#503028';
        g.beginPath();
        g.moveTo(x - 42 * s, y - 32 * s);
        g.lineTo(x + 30 * s, y - 32 * s);
        g.quadraticCurveTo(x + 66 * s, y - 38 * s, x + 30 * s, y - 45 * s);
        g.lineTo(x - 42 * s, y - 45 * s);
        g.closePath();
        g.fill();
        g.strokeStyle = hexA(b.glow, 0.75);
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(x - 42 * s, y - 45 * s);
        g.lineTo(x + 30 * s, y - 45 * s);
        g.stroke();
        // Glühendes Werkstück auf der Bahn
        g.fillStyle = hexA(b.glow, 0.85);
        g.fillRect(x - 14 * s, y - 51 * s, 26 * s, 6 * s);
      };
      anvil(96, VH - 106, 1.25);
      anvil(628, VH - 92, 1.05);

      // Schlackekegel
      for (const [x, h, w] of [[250, 128, 66], [418, 96, 52], [524, 74, 42], [34, 86, 46]]) {
        const cg = g.createLinearGradient(x, VH - 40 - h, x, VH - 40);
        cg.addColorStop(0, '#4a2418');
        cg.addColorStop(1, '#160a06');
        g.fillStyle = cg;
        g.beginPath();
        g.moveTo(x - w, VH - 30);
        g.lineTo(x, VH - 30 - h);
        g.lineTo(x + w, VH - 30);
        g.closePath();
        g.fill();
        g.fillStyle = hexA(b.glow, 0.55);
        g.beginPath();
        g.moveTo(x - 7, VH - 30 - h + 5);
        g.lineTo(x, VH - 30 - h);
        g.lineTo(x + 7, VH - 30 - h + 5);
        g.closePath();
        g.fill();
        const sm = g.createRadialGradient(x, VH - 34 - h, 2, x, VH - 34 - h, 46);
        sm.addColorStop(0, hexA(b.glow, 0.22));
        sm.addColorStop(1, hexA(b.glow, 0));
        g.fillStyle = sm;
        g.beginPath();
        g.arc(x, VH - 34 - h, 46, 0, Math.PI * 2);
        g.fill();
      }
      // Glutrisse im Boden
      for (let i = 0; i < 16; i++) {
        crack(g, rnd() * VW, VH - 60 - rnd() * 80, 40 + rnd() * 120, b.glow, 0.7, rnd);
      }
      const floorGlow = g.createLinearGradient(0, VH - 130, 0, VH);
      floorGlow.addColorStop(0, hexA(b.glow, 0));
      floorGlow.addColorStop(1, hexA(b.glow, 0.3));
      g.fillStyle = floorGlow;
      g.fillRect(-OVERSCAN, VH - 130, VW + OVERSCAN * 2, 130 + OVERSCAN);
    },
  },

  // --- Eisdom --------------------------------------------------------------
  eisdom: {
    far(g, b, rnd) {
      // Gewölberippen: zwei Reihen spitzbogiger Gurte
      g.strokeStyle = hexA(b.glow, 0.16);
      g.lineWidth = 5;
      for (const [y0, span] of [[300, 250], [640, 320], [980, 400]]) {
        for (let k = -1; k <= 1; k++) {
          const cx = VW / 2 + k * span;
          g.beginPath();
          g.moveTo(cx - span * 0.6, y0 + 220);
          g.quadraticCurveTo(cx, y0 - 140, cx + span * 0.6, y0 + 220);
          g.stroke();
        }
      }
      // Eissäulen als Silhouette
      for (let i = 0; i < 10; i++) {
        const x = rnd() * VW;
        const w = 20 + rnd() * 44;
        g.fillStyle = hexA(mix(b.rock, b.glow, 0.3), 0.3);
        g.beginPath();
        g.moveTo(x - w, VH - 80);
        g.lineTo(x - w * 0.6, 240 + rnd() * 300);
        g.lineTo(x + w * 0.6, 240 + rnd() * 300);
        g.lineTo(x + w, VH - 80);
        g.closePath();
        g.fill();
      }
      // Frostfarne an den Rändern
      for (let i = 0; i < 10; i++) {
        frostFern(g, rnd() < 0.5 ? 20 + rnd() * 120 : VW - 20 - rnd() * 120,
          160 + rnd() * 780, 40 + rnd() * 60, rnd() * 6.28, hexA(b.glow, 0.16), rnd);
      }
    },
    ceiling(g, b, rnd) {
      ceilingSlab(g, b, rnd, 30, 8);
      // Gewölbe: Bögen, die aus der Decke wachsen
      g.strokeStyle = hexA(mix(b.glow, '#ffffff', 0.4), 0.4);
      g.lineWidth = 3.5;
      for (let k = 0; k < 5; k++) {
        const cx = 72 + k * 144;
        g.beginPath();
        g.moveTo(cx - 66, CEILING_Y + 30);
        g.quadraticCurveTo(cx, CEILING_Y - 44, cx + 66, CEILING_Y + 30);
        g.stroke();
      }
      // Eiszapfen
      for (let i = 0; i < 40; i++) {
        const x = -10 + rnd() * (VW + 20);
        const h = 12 + rnd() * 62;
        const w = 3.5 + rnd() * 8;
        const ig = g.createLinearGradient(x, CEILING_Y - 12, x, CEILING_Y + h);
        ig.addColorStop(0, 'rgba(224,246,255,0.85)');
        ig.addColorStop(0.5, hexA(b.glow, 0.4));
        ig.addColorStop(1, hexA(b.glow, 0.05));
        g.fillStyle = ig;
        g.beginPath();
        g.moveTo(x - w, CEILING_Y - 12);
        g.lineTo(x + w, CEILING_Y - 12);
        g.lineTo(x, CEILING_Y + h);
        g.closePath();
        g.fill();
      }
      g.fillStyle = 'rgba(210,240,255,0.25)';
      g.fillRect(-OVERSCAN, CEILING_Y - 4, VW + OVERSCAN * 2, 3);
    },
    floor(g, b, rnd) {
      // Eissäulen vorn
      for (const [x, h, w] of [[48, 254, 46], [126, 178, 32], [606, 226, 42], [682, 158, 30], [296, 128, 24], [432, 142, 26]]) {
        const cg = g.createLinearGradient(x - w, VH - 30, x + w, VH - 30 - h);
        cg.addColorStop(0, hexA(mix(b.rock, b.glow, 0.45), 0.88));
        cg.addColorStop(0.6, hexA(mix(b.glow, '#ffffff', 0.55), 0.72));
        cg.addColorStop(1, 'rgba(244,253,255,0.9)');
        g.fillStyle = cg;
        g.beginPath();
        g.moveTo(x - w, VH - 20);
        g.lineTo(x - w * 0.55, VH - 20 - h * 0.8);
        g.lineTo(x, VH - 20 - h);
        g.lineTo(x + w * 0.6, VH - 20 - h * 0.66);
        g.lineTo(x + w, VH - 20);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.4)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(x, VH - 20 - h);
        g.lineTo(x + w * 0.2, VH - 20);
        g.stroke();
      }
      // Gefrorener Boden mit Sprüngen
      g.fillStyle = 'rgba(180,226,255,0.14)';
      g.fillRect(-OVERSCAN, VH - 60, VW + OVERSCAN * 2, 60 + OVERSCAN);
      g.strokeStyle = 'rgba(224,246,255,0.3)';
      g.lineWidth = 1.4;
      for (let i = 0; i < 14; i++) {
        const x = rnd() * VW, y = VH - 56 + rnd() * 50;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (rnd() - 0.5) * 90, y + (rnd() - 0.5) * 22);
        g.stroke();
      }
      for (let i = 0; i < 6; i++) {
        frostFern(g, rnd() * VW, VH - 30 - rnd() * 50, 34 + rnd() * 40, -1.2 + rnd(), 'rgba(224,246,255,0.3)', rnd);
      }
    },
  },

  // --- Wolkenzitadelle -----------------------------------------------------
  wolkenzitadelle: {
    far(g, b, rnd) {
      // Schwebende Türme. Sie müssen als Form lesbar sein, dürfen aber im
      // Spielfeld nicht mit den Steinen konkurrieren — deshalb bleiben sie
      // eine flache Silhouette ohne Binnenzeichnung.
      const tower = (x, y, s, alpha) => {
        const body = hexA(mix(b.rock, '#ffffff', 0.16), alpha);
        g.fillStyle = body;
        g.fillRect(x - 22 * s, y - 130 * s, 44 * s, 130 * s);
        g.beginPath();                       // Dach
        g.moveTo(x - 32 * s, y - 128 * s);
        g.lineTo(x, y - 188 * s);
        g.lineTo(x + 32 * s, y - 128 * s);
        g.closePath();
        g.fill();
        g.beginPath();                       // Fels darunter
        g.moveTo(x - 26 * s, y - 2 * s);
        g.lineTo(x + 26 * s, y - 2 * s);
        g.lineTo(x + 4 * s, y + 74 * s);
        g.closePath();
        g.fill();
        // Erker
        g.fillRect(x - 34 * s, y - 96 * s, 12 * s, 34 * s);
        g.fillRect(x + 22 * s, y - 84 * s, 12 * s, 30 * s);
        g.fillStyle = hexA(b.glow, alpha * 0.55);
        for (let k = 0; k < 3; k++) {
          g.fillRect(x - 5 * s, y - (108 - k * 34) * s, 10 * s, 14 * s);
        }
        // Wimpel
        g.strokeStyle = hexA(b.glow, alpha * 0.7);
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(x, y - 188 * s);
        g.lineTo(x, y - 212 * s);
        g.stroke();
        g.fillStyle = hexA(b.glow, alpha * 0.55);
        g.beginPath();
        g.moveTo(x, y - 210 * s);
        g.lineTo(x + 22 * s, y - 202 * s);
        g.lineTo(x, y - 194 * s);
        g.closePath();
        g.fill();
      };
      tower(112, 706, 0.82, 0.7);
      tower(600, 618, 0.7, 0.62);
      tower(332, 902, 0.52, 0.5);
      // Wolkenbänke
      for (let i = 0; i < 8; i++) {
        cloudBank(g, 180 + i * 118 + rnd() * 40, 58 + rnd() * 50,
          `rgba(214,196,255,${0.09 + rnd() * 0.09})`, rnd);
      }
    },
    ceiling(g, b, rnd) {
      // Statt Fels: eine dichte, helle Wolkendecke mit goldenem Bogen
      const sl = g.createLinearGradient(0, -OVERSCAN, 0, CEILING_Y + 10);
      sl.addColorStop(0, mix(b.rock, '#ffffff', 0.18));
      sl.addColorStop(1, mix(b.rock, '#000000', 0.1));
      g.fillStyle = sl;
      g.fillRect(-OVERSCAN, -OVERSCAN, VW + OVERSCAN * 2, CEILING_Y + OVERSCAN - 4);
      // Wolkiger Rand nach unten
      g.fillStyle = mix(b.rock, '#000000', 0.1);
      g.beginPath();
      g.moveTo(-OVERSCAN, CEILING_Y - 20);
      for (let x = -OVERSCAN; x <= VW + OVERSCAN; x += 38) {
        g.quadraticCurveTo(x + 19, CEILING_Y + 12 + rnd() * 6, x + 38, CEILING_Y - 6 - rnd() * 8);
      }
      g.lineTo(VW + OVERSCAN, CEILING_Y - 30);
      g.lineTo(-OVERSCAN, CEILING_Y - 30);
      g.closePath();
      g.fill();
      // Goldener Torbogen in der Mitte
      g.strokeStyle = hexA(b.glow, 0.55);
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(VW / 2 - 120, CEILING_Y + 34);
      g.quadraticCurveTo(VW / 2, CEILING_Y - 60, VW / 2 + 120, CEILING_Y + 34);
      g.stroke();
      g.strokeStyle = hexA(b.glow, 0.18);
      g.lineWidth = 14;
      g.stroke();
      // Schlussstein
      g.fillStyle = hexA(b.glow, 0.7);
      g.beginPath();
      g.moveTo(VW / 2, CEILING_Y - 26);
      g.lineTo(VW / 2 + 13, CEILING_Y - 10);
      g.lineTo(VW / 2, CEILING_Y + 8);
      g.lineTo(VW / 2 - 13, CEILING_Y - 10);
      g.closePath();
      g.fill();
      // Kleine Sterne rechts und links
      for (let i = 0; i < 16; i++) {
        const x = rnd() * VW, y = 4 + rnd() * 44;
        g.fillStyle = `rgba(255,244,214,${0.2 + rnd() * 0.4})`;
        g.beginPath();
        g.arc(x, y, 0.9 + rnd() * 1.6, 0, Math.PI * 2);
        g.fill();
      }
    },
    floor(g, b, rnd) {
      // Dichte Wolkenbänke, aus denen die Zitadelle ragt
      for (let i = 0; i < 5; i++) {
        cloudBank(g, VH - 96 - i * 46, 84 - i * 8,
          `rgba(${212 - i * 12},${198 - i * 14},255,${0.2 + i * 0.06})`, rnd);
      }
      // Zwei nahe Türme links und rechts
      const near = (x, s, flip) => {
        g.fillStyle = 'rgba(60,50,102,0.96)';
        g.fillRect(x - 34 * s, VH - 230 * s, 68 * s, 230 * s);
        g.beginPath();
        g.moveTo(x - 46 * s, VH - 228 * s);
        g.lineTo(x, VH - 300 * s);
        g.lineTo(x + 46 * s, VH - 228 * s);
        g.closePath();
        g.fill();
        // Zinnen
        for (let k = -2; k <= 2; k++) g.fillRect(x + k * 16 * s - 5 * s, VH - 240 * s, 10 * s, 14 * s);
        // Fenster
        g.fillStyle = hexA(b.glow, 0.8);
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          g.moveTo(x - 8 * s + flip * 2, VH - (200 - k * 56) * s);
          g.lineTo(x + 8 * s + flip * 2, VH - (200 - k * 56) * s);
          g.lineTo(x + 8 * s + flip * 2, VH - (182 - k * 56) * s);
          g.quadraticCurveTo(x + flip * 2, VH - (170 - k * 56) * s, x - 8 * s + flip * 2, VH - (182 - k * 56) * s);
          g.closePath();
          g.fill();
        }
        g.strokeStyle = hexA(b.glow, 0.35);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x - 46 * s, VH - 228 * s);
        g.lineTo(x, VH - 300 * s);
        g.lineTo(x + 46 * s, VH - 228 * s);
        g.stroke();
      };
      near(56, 0.9, 0);
      near(670, 0.78, 0);
      // Vorderste Wolkenbank verdeckt die Turmfüße
      cloudBank(g, VH - 62, 92, 'rgba(226,214,255,0.34)', rnd);
      cloudBank(g, VH - 24, 74, 'rgba(240,232,255,0.36)', rnd);
    },
  },
};

/** Glutriss: eine gezackte, leuchtende Linie. */
function crack(g, x, y, len, color, alpha, rnd) {
  const dir = rnd() * Math.PI * 2;
  let px = x, py = y;
  g.strokeStyle = hexA(color, alpha);
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(px, py);
  const steps = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < steps; i++) {
    const a = dir + (rnd() - 0.5) * 1.6;
    px += Math.cos(a) * (len / steps);
    py += Math.sin(a) * (len / steps) * 0.5;
    g.lineTo(px, py);
  }
  g.stroke();
  g.strokeStyle = hexA(color, alpha * 0.28);
  g.lineWidth = 7;
  g.stroke();
}

/** Frostfarn: ein Mittelstrich mit Seitenzweigen. */
function frostFern(g, x, y, len, ang, color, rnd) {
  g.strokeStyle = color;
  g.lineWidth = 1.6;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + dx * len, y + dy * len);
  g.stroke();
  g.lineWidth = 1;
  for (let i = 1; i <= 6; i++) {
    const t = i / 7;
    const bx = x + dx * len * t, by = y + dy * len * t;
    const bl = len * 0.34 * (1 - t) + 4;
    for (const s of [-1, 1]) {
      const a = ang + s * (0.7 + rnd() * 0.2);
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx + Math.cos(a) * bl, by + Math.sin(a) * bl);
      g.stroke();
    }
  }
}

/** Weiche Wolkenbank über die volle Breite. */
function cloudBank(g, y, amp, color, rnd) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-OVERSCAN, y + amp * 2);
  let x = -OVERSCAN;
  while (x < VW + OVERSCAN) {
    const w = 60 + rnd() * 90;
    g.quadraticCurveTo(x + w * 0.5, y - amp * (0.5 + rnd() * 0.8), x + w, y - amp * 0.1);
    x += w;
  }
  g.lineTo(VW + OVERSCAN, y + amp * 2);
  g.closePath();
  g.fill();
}

// --- Symbole (Farbfehlsichtigkeit) ---------------------------------------------

/**
 * Die fünf Symbole müssen auf jedem Untergrund lesbar bleiben. Deshalb liegt
 * unter jeder Form eine dunkle, leicht versetzte Kopie: Sie wirkt wie eine
 * Gravur und hält den Kontrast auch auf der hellsten Facette.
 */
function drawSymbol(g, kind, s) {
  g.save();
  g.lineJoin = 'round';
  const path = () => {
    g.beginPath();
    switch (kind) {
      case 'circle':
        g.arc(0, 0, s * 0.72, 0, Math.PI * 2);
        break;
      case 'diamond':
        g.moveTo(0, -s); g.lineTo(s * 0.8, 0); g.lineTo(0, s); g.lineTo(-s * 0.8, 0); g.closePath();
        break;
      case 'triangle':
        g.moveTo(0, -s * 0.92); g.lineTo(s * 0.88, s * 0.68); g.lineTo(-s * 0.88, s * 0.68); g.closePath();
        break;
      case 'star': {
        const spikes = 5;
        for (let i = 0; i < spikes * 2; i++) {
          const rr = i % 2 === 0 ? s : s * 0.44;
          const ang = -Math.PI / 2 + (i * Math.PI) / spikes;
          const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
        break;
      }
      case 'wave':
        g.moveTo(-s, s * 0.25);
        g.quadraticCurveTo(-s * 0.5, -s * 0.75, 0, s * 0.05);
        g.quadraticCurveTo(s * 0.5, s * 0.85, s, -s * 0.15);
        break;
    }
  };

  if (kind === 'wave') {
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(16,6,36,0.6)';
    g.lineWidth = 7.5;
    g.save(); g.translate(0, 1.4); path(); g.stroke(); g.restore();
    path();
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 4.4;
    path();
    g.stroke();
    g.restore();
    return;
  }

  // Gravurschatten
  g.fillStyle = 'rgba(16,6,36,0.5)';
  g.save(); g.translate(0, 1.6); path(); g.fill(); g.restore();
  // Fläche
  g.fillStyle = 'rgba(255,255,255,0.86)';
  path();
  g.fill();
  g.strokeStyle = 'rgba(16,6,36,0.62)';
  g.lineWidth = 2.2;
  g.stroke();
  g.restore();
}

// --- Hilfen ---------------------------------------------------------------------

/** Streckenzug aus [x,y]-Paaren als geschlossener Pfad. */
function poly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

/** '#rrggbb' + Alpha -> 'rgba(...)' */
export function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Zwei Hexfarben mischen, t = 0 -> a, t = 1 -> b. */
function mix(a, b, t) {
  const pa = parseInt(a.replace('#', ''), 16);
  const pb = parseInt(b.replace('#', ''), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const c = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | c).toString(16).slice(1)}`;
}

function pointOn(points, dist) {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= dist) {
      const t = seg === 0 ? 0 : (dist - acc) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += seg;
  }
  return points[points.length - 1];
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashKey(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
