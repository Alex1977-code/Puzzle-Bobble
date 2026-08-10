/**
 * Canvas-2D-Renderer.
 *
 * Alle Grafiken entstehen prozedural im Code — keine Bilddateien.
 * Die Steine werden einmalig je Farbe und Bildschirmmaßstab in Offscreen-
 * Canvasse vorgezeichnet; pro Bild ist dann nur noch ein drawImage nötig.
 * Das ist der entscheidende Hebel für 60 fps auf Mittelklasse-Geräten.
 */
import {
  VW, VH, R, D, PLAY_LEFT, PLAY_RIGHT, CEILING_Y, FAIL_Y,
  COLORS, PREVIEW_DOT_SPACING, PREVIEW_MAX_BOUNCES, SHOOTER_X, SHOOTER_Y,
  POP_MS,
} from '../game/config.js';
import { SPLITTER } from '../fx/particles.js';

const SPRITE_PAD = 6;   // Platz für Glanzrand innerhalb der Sprite-Kachel
const SPARK_SIZE = 28;  // Kantenlänge der Funken-Kachel in virtuellen Einheiten
const OVERSCAN = 20;    // Reserve am Rand für den Screenshake

// Kristallsplitter werden in 16 fertig gedrehten Bildern je Farbe vorgebacken.
// Eine Drehung zur Laufzeit kostet pro Partikel ein save/rotate/restore, und
// das ist bei 300 Partikeln um Größenordnungen teurer als das Zeichnen selbst
// (gemessen: 24 ms gegenüber 4 ms je Bild).
const SHARD_SIZE = 26;
const SHARD_FRAMES = 16;

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
    for (let i = 0; i < COLORS.length; i++) {
      this.sprites.set(`gem${i}`, this._bakeGem(COLORS[i]));
      this.sprites.set(`funke${i}`, this._bakeSpark(COLORS[i]));
      this.sprites.set(`splitter${i}`, this._bakeShards(COLORS[i]));
    }
    this.shardFrame = Math.max(4, Math.ceil(SHARD_SIZE * this.spriteScale));
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

      g.strokeStyle = hexA(color.light, 0.8);
      g.lineWidth = 1.2;
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

  /** Ein Kristallstein: Verlauf, Facettenkante, Glanzlicht, Symbol. */
  _bakeGem(color) {
    const sv = this._spriteSizeVirtual();
    const s = this.spriteScale;
    const px = Math.max(8, Math.ceil(sv * s));
    const cv = document.createElement('canvas');
    cv.width = px; cv.height = px;
    const g = cv.getContext('2d');
    g.setTransform(px / sv, 0, 0, px / sv, 0, 0);

    const cx = sv / 2, cy = sv / 2;

    // Weicher Außenschein
    const halo = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R + SPRITE_PAD);
    halo.addColorStop(0, hexA(color.base, 0.35));
    halo.addColorStop(1, hexA(color.base, 0));
    g.fillStyle = halo;
    g.beginPath();
    g.arc(cx, cy, R + SPRITE_PAD, 0, Math.PI * 2);
    g.fill();

    // Körper
    const body = g.createRadialGradient(cx - R * 0.34, cy - R * 0.4, R * 0.12, cx, cy, R);
    body.addColorStop(0, color.light);
    body.addColorStop(0.45, color.base);
    body.addColorStop(1, color.dark);
    g.fillStyle = body;
    g.beginPath();
    g.arc(cx, cy, R - 1, 0, Math.PI * 2);
    g.fill();

    // Facetten: zwei schräge Keile, die den Kristall brechen lassen
    g.save();
    g.beginPath();
    g.arc(cx, cy, R - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.beginPath();
    g.moveTo(cx - R, cy - R * 0.15);
    g.lineTo(cx + R * 0.2, cy - R);
    g.lineTo(cx + R, cy - R * 0.55);
    g.lineTo(cx - R * 0.3, cy + R * 0.25);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.beginPath();
    g.moveTo(cx - R, cy + R * 0.35);
    g.lineTo(cx + R, cy + R * 0.05);
    g.lineTo(cx + R, cy + R);
    g.lineTo(cx - R * 0.4, cy + R);
    g.closePath();
    g.fill();
    g.restore();

    // Innerer Rand
    g.strokeStyle = hexA(color.light, 0.55);
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(cx, cy, R - 2.4, 0, Math.PI * 2);
    g.stroke();

    // Symbol für Farbfehlsichtige
    g.save();
    g.translate(cx, cy);
    drawSymbol(g, color.symbol, R * 0.46);
    g.restore();

    // Glanzlicht
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gl = g.createRadialGradient(cx - R * 0.36, cy - R * 0.44, 0, cx - R * 0.36, cy - R * 0.44, R * 0.5);
    gl.addColorStop(0, 'rgba(255,255,255,0.85)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl;
    g.beginPath();
    g.ellipse(cx - R * 0.34, cy - R * 0.42, R * 0.42, R * 0.30, -0.5, 0, Math.PI * 2);
    g.fill();
    g.restore();

    return cv;
  }

  /** Stein an virtueller Position zeichnen. */
  drawStone(color, x, y, { alpha = 1, scale = 1, rot = 0, sx = 1, sy = 1 } = {}) {
    const sprite = this.sprites.get(`gem${color}`);
    if (!sprite) return;
    const ctx = this.ctx;
    const sv = this._spriteSizeVirtual();
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
    // Etwas größer als das Spielfeld, damit beim Screenshake kein Rand aufblitzt.
    ctx.drawImage(this.bg, -OVERSCAN, -OVERSCAN, VW + OVERSCAN * 2, VH + OVERSCAN * 2);
  }

  _bakeBackground(biome) {
    this.bgKey = biome.key;
    const s = this.spriteScale || 1;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(VW * s);
    cv.height = Math.ceil(VH * s);
    const g = cv.getContext('2d');
    g.setTransform(s, 0, 0, s, 0, 0);

    const sky = g.createLinearGradient(0, 0, 0, VH);
    sky.addColorStop(0, biome.sky[0]);
    sky.addColorStop(1, biome.sky[1]);
    g.fillStyle = sky;
    g.fillRect(0, 0, VW, VH);

    // Ferne Kristallzacken als Silhouette
    const rnd = seeded(1337);
    g.fillStyle = hexA(biome.rock, 0.55);
    for (let i = 0; i < 14; i++) {
      const bx = rnd() * VW;
      const bw = 40 + rnd() * 90;
      const bh = 120 + rnd() * 320;
      g.beginPath();
      g.moveTo(bx - bw / 2, VH);
      g.lineTo(bx, VH - bh);
      g.lineTo(bx + bw / 2, VH);
      g.closePath();
      g.fill();
    }

    // Glimmen im Hintergrund
    const glow = g.createRadialGradient(VW / 2, 420, 40, VW / 2, 420, 620);
    glow.addColorStop(0, hexA(biome.glow, 0.14));
    glow.addColorStop(1, hexA(biome.glow, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, VW, VH);

    // Höhlendecke
    const rock = g.createLinearGradient(0, 0, 0, CEILING_Y + 18);
    rock.addColorStop(0, '#100a1e');
    rock.addColorStop(1, biome.rock);
    g.fillStyle = rock;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(VW, 0);
    g.lineTo(VW, CEILING_Y);
    // Zackige Unterkante
    const teeth = 22;
    for (let i = teeth; i >= 0; i--) {
      const x = (i / teeth) * VW;
      const y = CEILING_Y - (i % 2 === 0 ? 0 : 9 + rnd() * 7);
      g.lineTo(x, y);
    }
    g.closePath();
    g.fill();

    // Seitenwände
    g.fillStyle = hexA(biome.rock, 0.85);
    g.fillRect(0, 0, PLAY_LEFT, VH);
    g.fillRect(PLAY_RIGHT, 0, VW - PLAY_RIGHT, VH);
    g.strokeStyle = hexA(biome.glow, 0.35);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(PLAY_LEFT, 0); g.lineTo(PLAY_LEFT, VH);
    g.moveTo(PLAY_RIGHT, 0); g.lineTo(PLAY_RIGHT, VH);
    g.stroke();

    // Hort am unteren Rand
    const hoard = g.createLinearGradient(0, VH - 130, 0, VH);
    hoard.addColorStop(0, 'rgba(0,0,0,0)');
    hoard.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = hoard;
    g.fillRect(0, VH - 130, VW, 130);

    this.bg = cv;
  }

  // --- Spielfeld-Beiwerk ----------------------------------------------------

  drawFailLine(pulse = 0) {
    const ctx = this.ctx;
    ctx.save();
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

  /**
   * Prozeduraler Kristalldrache als Schleuder.
   *
   * Der Kopf lehnt sich nur anteilig in die Zielrichtung — sonst kippt das
   * Gesicht bei 78° unleserlich weg. Die exakte Richtung zeigt stattdessen der
   * Glutkegel, der vom Abschusspunkt (360, 1150) genau entlang der Zielachse
   * austritt; dort liegt auch der geladene Stein.
   */
  drawDragon(aimDeg, charge = 0, recoil = 0) {
    const ctx = this.ctx;
    const a = aimDeg * Math.PI / 180;

    ctx.save();
    ctx.translate(SHOOTER_X, SHOOTER_Y);

    // Hort-Sockel, in den die abgestürzten Steine fallen
    ctx.fillStyle = 'rgba(8,4,18,0.78)';
    ctx.beginPath();
    ctx.ellipse(0, 152, 196, 62, 0, 0, Math.PI * 2);
    ctx.fill();

    // Flügel
    ctx.save();
    ctx.rotate(a * 0.1);
    ctx.fillStyle = 'rgba(126,92,236,0.34)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 26, 46);
      ctx.quadraticCurveTo(s * 150, 18, s * 132, 100);
      ctx.quadraticCurveTo(s * 92, 74, s * 34, 88);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Körper
    const body = ctx.createLinearGradient(0, 40, 0, 150);
    body.addColorStop(0, '#4c31a6');
    body.addColorStop(0.6, '#2c1c6b');
    body.addColorStop(1, '#150d34');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 100, 66, 52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,232,170,0.12)';
    ctx.beginPath();
    ctx.ellipse(0, 116, 32, 24, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- Kopf (lehnt anteilig) ----------------------------------------------
    ctx.save();
    // Rückstoß: der Kopf fährt entgegen der Schussrichtung zurück.
    if (recoil > 0) ctx.translate(-Math.sin(a) * recoil * 13, Math.cos(a) * recoil * 13);
    ctx.rotate(a * 0.4);

    ctx.fillStyle = '#ded0ff';
    ctx.strokeStyle = 'rgba(40,20,80,0.45)';
    ctx.lineWidth = 1.5;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 30, 8);
      ctx.quadraticCurveTo(s * 58, -12, s * 54, -46);
      ctx.quadraticCurveTo(s * 40, -14, s * 18, 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    const head = ctx.createLinearGradient(0, -18, 0, 80);
    head.addColorStop(0, '#c6adff');
    head.addColorStop(0.5, '#7d56ec');
    head.addColorStop(1, '#33207d');
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.ellipse(0, 30, 49, 46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(224,208,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Maul: dunkle Öffnung, in der der Stein liegt
    ctx.fillStyle = 'rgba(22,7,42,0.92)';
    ctx.beginPath();
    ctx.moveTo(-40, 12);
    ctx.quadraticCurveTo(0, -20, 40, 12);
    ctx.quadraticCurveTo(0, 30, -40, 12);
    ctx.closePath();
    ctx.fill();

    // Fangzähne
    ctx.fillStyle = '#f4eeff';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 32, 14);
      ctx.lineTo(s * 24, -6);
      ctx.lineTo(s * 17, 17);
      ctx.closePath();
      ctx.fill();
    }

    // Augen
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath();
      ctx.ellipse(s * 25, 44, 9, 11, s * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a1550';
      ctx.beginPath();
      ctx.ellipse(s * 25, 44, 3, 8.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(s * 25 + 3, 40, 2.2, 0, Math.PI * 2);
      ctx.fill();
      // Braue: macht aus dem Auge ein Gesicht
      ctx.strokeStyle = 'rgba(28,14,58,0.85)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(s * 25, 46, 12, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
    }

    // Nüstern
    ctx.fillStyle = 'rgba(30,12,60,0.7)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 12, 24, 3.4, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // --- Glutkegel exakt in Zielrichtung ------------------------------------
    ctx.save();
    if (recoil > 0) ctx.translate(-Math.sin(a) * recoil * 13, Math.cos(a) * recoil * 13);
    ctx.rotate(a);
    const jet = ctx.createLinearGradient(0, 12, 0, -66);
    jet.addColorStop(0, `rgba(255,214,120,${0.55 + charge * 0.35})`);
    jet.addColorStop(1, 'rgba(255,120,50,0)');
    ctx.fillStyle = jet;
    ctx.beginPath();
    ctx.moveTo(-19, 14);
    ctx.quadraticCurveTo(0, -70 - charge * 14, 19, 14);
    ctx.quadraticCurveTo(0, 26, -19, 14);
    ctx.closePath();
    ctx.fill();
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

// --- Symbole (Farbfehlsichtigkeit) ---------------------------------------------

function drawSymbol(g, kind, s) {
  g.save();
  g.strokeStyle = 'rgba(20,10,40,0.55)';
  g.fillStyle = 'rgba(255,255,255,0.72)';
  g.lineWidth = 2;
  g.lineJoin = 'round';
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
      g.lineWidth = 4.5;
      g.strokeStyle = 'rgba(255,255,255,0.78)';
      g.stroke();
      g.strokeStyle = 'rgba(20,10,40,0.4)';
      g.lineWidth = 1.4;
      g.stroke();
      g.restore();
      return;
  }
  g.fill();
  g.stroke();
  g.restore();
}

// --- Hilfen ---------------------------------------------------------------------

/** '#rrggbb' + Alpha -> 'rgba(...)' */
export function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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
