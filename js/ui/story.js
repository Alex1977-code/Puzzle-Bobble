/**
 * DRACHENFUNKE — Storytafeln.
 *
 * Fünf prozedural gezeichnete Standbilder, die den Pitch erzählen: ein junger
 * Kristalldrache in einer leeren Höhle entdeckt, dass er Edelsteine spucken
 * kann, bringt damit die Decke zum Einsturz und füllt seinen Hort.
 *
 * Die Tafeln kennen den Spielzustand nicht. Sie zeichnen ganzflächig in
 * virtuellen Einheiten (720 x 1280) in den laufenden Renderer-Kontext und
 * verwenden dessen vorgebackene Steine und Drachenteile — dadurch ist die
 * Figur in der Geschichte dieselbe wie im Spiel.
 *
 * Aufbau wie im Renderer: Was sich nicht bewegt, wird einmal je Tafel und
 * Maßstab in ein Offscreen-Canvas gebacken; pro Bild bleibt ein drawImage.
 * Bewegt werden nur der Drache, fliegende Steine und das Licht.
 */

// --- Maße (eigene Konstanten, damit die Datei für sich steht) ----------------
const VW = 720;
const VH = 1280;

const PLATE_X = 46;
const PLATE_W = 628;
const PLATE_Y = 966;
const PLATE_H = 232;
const TEXT_SIZE = 21;
const TEXT_LEAD = 30;

const GOLD = '#ffe2a0';
const INK = '#d8cbf6';

export const STORY_PANELS = [
  {
    titel: 'Ein leerer Hort',
    text: 'Tief unter dem Gebirge wächst ein junger Kristalldrache heran. '
        + 'Andere Drachen schlafen auf Bergen von Gold — sein Hort besteht aus '
        + 'drei Steinen und sehr viel Staub.',
  },
  {
    titel: 'Der erste Funke',
    text: 'Beim Niesen fährt ihm ein Funke durch die Kehle, und ein Edelstein '
        + 'schießt aus seinem Maul. Er prallt gegen die Höhlendecke und bleibt '
        + 'dort kleben. Der Kleine staunt.',
  },
  {
    titel: 'Die Decke trägt Farben',
    text: 'Je öfter er spuckt, desto voller wird die Decke. Die Steine halten '
        + 'sich gegenseitig fest, Farbe an Farbe, bis das ganze Gewölbe über '
        + 'ihm funkelt.',
  },
  {
    titel: 'Drei sind genug',
    text: 'Treffen drei gleiche Farben aufeinander, zerspringen sie mit hellem '
        + 'Klang. Alles, was danach an nichts mehr hängt, stürzt herab — '
        + 'geradewegs vor seine Klauen.',
  },
  {
    titel: 'Der Hort wächst',
    text: 'Stein um Stein füllt sich der Schatz. Fünf Höhlen liegen vor ihm, '
        + 'von der Lavaschmiede bis zur Wolkenzitadelle. Zeit, tief Luft zu holen.',
  },
];

// --- Zwischenspeicher der gebackenen Kulissen --------------------------------
/** @type {Map<number, HTMLCanvasElement>} */
const scenery = new Map();
let sceneryScale = 0;

/**
 * Eine Storytafel zeichnen.
 *
 * @param {import('../core/render.js').Renderer} r  Renderer-Instanz
 * @param {number} index  Nummer der Tafel, 0..STORY_PANELS.length-1
 * @param {number} t      Einblendfortschritt 0..1; bei t = 1 steht das Bild
 */
export function drawStoryPanel(r, index, t) {
  const panel = STORY_PANELS[index];
  if (!panel) return;
  const k = clamp(t, 0, 1);
  const ctx = r.ctx;

  ctx.save();
  // Grundton, damit auch bei t = 0 nichts durchscheint
  ctx.fillStyle = '#07050f';
  ctx.fillRect(0, 0, VW, VH);

  // Kulisse
  ctx.globalAlpha = ease(clamp(k / 0.5, 0, 1));
  ctx.drawImage(sceneryFor(r, index), 0, 0, VW, VH);
  ctx.globalAlpha = 1;

  // Bewegtes
  const rise = (1 - ease(k)) * 26;
  ctx.save();
  ctx.translate(0, rise);
  ctx.globalAlpha = ease(clamp((k - 0.12) / 0.6, 0, 1));
  SCENES[index](r, k);
  ctx.restore();
  ctx.globalAlpha = 1;

  // Text
  drawPlate(r, panel, index, clamp((k - 0.4) / 0.5, 0, 1));
  ctx.restore();
}

// --- Texttafel ---------------------------------------------------------------

function drawPlate(r, panel, index, a) {
  if (a <= 0) return;
  const ctx = r.ctx;
  const slide = (1 - ease(a)) * 22;
  ctx.save();
  ctx.translate(0, slide);

  r.roundRect(PLATE_X, PLATE_Y, PLATE_W, PLATE_H, 26,
    `rgba(9,5,22,${0.86 * a})`, `rgba(176,148,255,${0.38 * a})`, 2);

  // Schmaler Lichtstrich als Kopfzeile
  ctx.globalAlpha = a;
  const line = ctx.createLinearGradient(PLATE_X + 28, 0, PLATE_X + PLATE_W - 28, 0);
  line.addColorStop(0, 'rgba(255,226,160,0.7)');
  line.addColorStop(1, 'rgba(255,226,160,0)');
  ctx.fillStyle = line;
  ctx.fillRect(PLATE_X + 28, PLATE_Y + 26, PLATE_W - 56, 2);
  ctx.globalAlpha = 1;

  r.text(panel.titel, PLATE_X + 30, PLATE_Y + 74, {
    size: 34, weight: 800, color: GOLD, alpha: a,
  });

  const lines = wrap(ctx, panel.text, PLATE_W - 60, TEXT_SIZE);
  for (let i = 0; i < lines.length; i++) {
    r.text(lines[i], PLATE_X + 30, PLATE_Y + 118 + i * TEXT_LEAD, {
      size: TEXT_SIZE, weight: 500, color: INK, alpha: a * 0.95,
    });
  }
  ctx.restore();

  // Tafelzähler
  const n = STORY_PANELS.length;
  const gap = 22;
  const x0 = VW / 2 - ((n - 1) * gap) / 2;
  ctx.save();
  ctx.globalAlpha = a;
  for (let i = 0; i < n; i++) {
    const on = i === index;
    ctx.fillStyle = on ? GOLD : 'rgba(216,203,246,0.28)';
    ctx.beginPath();
    ctx.arc(x0 + i * gap, PLATE_Y + PLATE_H + 34, on ? 5.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Zeilenumbruch nach Wortgrenzen, gemessen im Zeichensatz des Renderers. */
function wrap(ctx, str, maxWidth, size) {
  ctx.save();
  ctx.font = `500 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const words = str.split(' ');
  const out = [];
  let line = '';
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(probe).width > maxWidth) {
      out.push(line);
      line = w;
    } else {
      line = probe;
    }
  }
  if (line) out.push(line);
  ctx.restore();
  return out;
}

// =============================================================================
//  Bewegte Ebene der fünf Tafeln
// =============================================================================

const SCENES = [
  // --- 1: der junge Drache in der leeren Höhle ------------------------------
  (r, t) => {
    const ctx = r.ctx;
    // Lichtschacht aus einem Riss in der Decke
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(0, 70, 0, 900);
    beam.addColorStop(0, `rgba(168,140,250,${0.1 + t * 0.07})`);
    beam.addColorStop(0.6, `rgba(150,120,240,${0.04 + t * 0.03})`);
    beam.addColorStop(1, 'rgba(140,110,240,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(334, 70);
    ctx.lineTo(386, 70);
    ctx.lineTo(452, 900);
    ctx.lineTo(268, 900);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    dragon(r, 360, 806, 0.52, -0.12, { asleep: true });
    ridge(ctx, 868, false);

    // Der ganze Hort: drei einsame Steine
    r.drawStone(3, 238, 862, { scale: 0.66 });
    r.drawStone(0, 478, 872, { scale: 0.58 });
    r.drawStone(2, 292, 886, { scale: 0.48 });

    // Ein einzelner Funke, der aus der Nase steigt
    breathSparks(ctx, 360, 762, t, 3);
  },

  // --- 2: der erste Funke ---------------------------------------------------
  (r, t) => {
    const ctx = r.ctx;
    dragon(r, 360, 830, 0.95, 0.06, { wide: true });
    ridge(ctx, 948, false);

    // Der Stein fliegt hoch und schlägt an der Decke an
    const fly = ease(clamp(t * 1.1, 0, 1));
    const y = 798 - fly * 560;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const trail = ctx.createLinearGradient(0, y, 0, 830);
    trail.addColorStop(0, 'rgba(255,236,186,0.5)');
    trail.addColorStop(0.2, 'rgba(255,190,100,0.12)');
    trail.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = trail;
    ctx.beginPath();
    ctx.moveTo(356, y);
    ctx.lineTo(364, y);
    ctx.quadraticCurveTo(376, 660, 398, 826);
    ctx.lineTo(322, 826);
    ctx.quadraticCurveTo(344, 660, 356, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    r.drawStone(1, 360, y, { scale: 1.15 });

    // Aufschlag an der Decke
    if (fly > 0.86) {
      const b = (fly - 0.86) / 0.14;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,236,180,${0.7 * (1 - b)})`;
      ctx.lineWidth = 5 * (1 - b) + 1;
      ctx.beginPath();
      ctx.arc(360, y, 34 + b * 58, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    breathSparks(ctx, 360, 790, t, 9);
  },

  // --- 3: die Decke trägt Farben -------------------------------------------
  (r, t) => {
    const ctx = r.ctx;
    // Schein der vollen Decke herab
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Die Fläche deckt den gesamten Verlauf ab — sonst entsteht an der
    // Rechteckkante eine sichtbare Naht.
    const gl = ctx.createLinearGradient(0, 120, 0, 940);
    gl.addColorStop(0, 'rgba(200,170,255,0)');
    gl.addColorStop(0.3, `rgba(200,170,255,${0.2 * t})`);
    gl.addColorStop(1, 'rgba(160,130,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(0, 120, VW, 820);
    ctx.restore();
    // Der Stein, der gerade unterwegs ist
    r.drawStone(4, 360, 790 - ease(t) * 130, { scale: 0.9, alpha: 0.9 });
    dragon(r, 360, 880, 0.52, 0.0, {});
    ridge(ctx, 936, false);
    breathSparks(ctx, 360, 846, t, 5);
  },

  // --- 4: drei gleiche Farben zerspringen -----------------------------------
  (r, t) => {
    const ctx = r.ctx;
    // Der Einschlag friert kurz vor dem Ende ein: Auch als Standbild bei t = 1
    // muss zu sehen sein, dass hier gerade drei Steine zerspringen.
    const e = ease(t) * 0.45;

    // Druckwelle
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255,190,205,${0.75 * (1 - e * 1.4)})`;
    ctx.lineWidth = 14 * (1 - e * 1.6) + 2;
    ctx.beginPath();
    ctx.arc(352, 300, 34 + e * 240, 0, Math.PI * 2);
    ctx.stroke();
    const fl = ctx.createRadialGradient(352, 300, 6, 352, 300, 170);
    fl.addColorStop(0, `rgba(255,160,185,${0.5 * (1 - e)})`);
    fl.addColorStop(1, 'rgba(255,90,130,0)');
    ctx.fillStyle = fl;
    ctx.beginPath();
    ctx.arc(352, 300, 170, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Die drei platzenden Steine — Squash-Stretch wie im Spiel
    const pop = [[352, 306], [286, 262], [418, 264]];
    for (const [x, y] of pop) {
      const w = Math.sin(e * Math.PI * 2) * 0.36;
      r.drawStone(0, x, y, {
        scale: (1 - e) * (1 + 0.5 * Math.sin(e * Math.PI)),
        alpha: 1 - e * e,
        sx: 1 + w, sy: 1 - w,
      });
    }
    // Splitter
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + 0.3;
      const d = 44 + e * (240 + (i % 5) * 46);
      ctx.fillStyle = `rgba(255,${150 + (i % 4) * 24},170,${0.85 * (1 - e)})`;
      ctx.beginPath();
      ctx.arc(352 + Math.cos(a) * d, 300 + Math.sin(a) * d * 0.9, 4.5 - (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Was danach an nichts mehr hängt, stürzt herab
    const fall = [
      [244, 372, 2, 0.0], [318, 410, 1, 0.14], [400, 392, 3, 0.06],
      [472, 356, 4, 0.2], [356, 476, 2, 0.24], [280, 492, 1, 0.3],
      [438, 474, 0, 0.16],
    ];
    for (const [x, y0, col, delay] of fall) {
      const f = clamp((t - delay) / (1 - delay), 0, 1);
      const y = y0 + f * f * 260;
      r.drawStone(col, x + Math.sin(f * 4 + col) * 12, y, {
        rot: f * (2 + col * 0.3), alpha: 1,
      });
    }

    dragon(r, 360, 890, 0.48, 0.0, {});
    ridge(ctx, 944, true);
  },

  // --- 5: der Hort wächst ---------------------------------------------------
  (r, t) => {
    const ctx = r.ctx;
    // Steine regnen in den Hort
    for (let i = 0; i < 9; i++) {
      const ph = (t * 1.4 + i * 0.11) % 1;
      const x = 96 + ((i * 137) % 540);
      const y = 210 + ph * 640;
      r.drawStone(i % 5, x, y, { scale: 0.72, alpha: 0.5 + ph * 0.5, rot: ph * 3 });
    }
    dragon(r, 360, 782, 0.86, 0.0, { proud: true });
    ridge(ctx, 902, true);

    // Frisch gelandete Steine oben auf dem Schatz
    r.drawStone(0, 156, 894, { scale: 0.6 });
    r.drawStone(2, 216, 906, { scale: 0.5 });
    r.drawStone(3, 552, 890, { scale: 0.62 });
    r.drawStone(4, 612, 908, { scale: 0.48 });

    // Goldschein über dem Schatz
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(360, 926, 20, 360, 926, 380);
    gl.addColorStop(0, `rgba(255,200,110,${0.12 + t * 0.08})`);
    gl.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(0, 546, VW, 734);   // deckt den ganzen Radius ab, keine Naht
    ctx.restore();
  },
];

// =============================================================================
//  Figur
// =============================================================================

/**
 * Der Drache aus den vorgebackenen Renderer-Ebenen. Dadurch sieht die Figur
 * in der Geschichte exakt so aus wie im Spiel — und kostet drei drawImage.
 *
 * @param {number} x,y  Lage des Mauls (der Nullpunkt der Drachenebenen)
 * @param {number} k    Maßstab
 * @param {number} tilt Kopfneigung in Radiant
 */
function dragon(r, x, y, k, tilt, { asleep = false, wide = false, proud = false } = {}) {
  const ctx = r.ctx;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);

  ctx.save();
  ctx.rotate(tilt * 0.3 + (proud ? -0.02 : 0));
  layer(r, 'drWings');
  ctx.restore();

  ctx.save();
  ctx.rotate(tilt);
  layer(r, 'drHead');
  if (asleep) sleepyEyes(ctx);
  if (wide) wideEyes(ctx);
  ctx.restore();

  layer(r, 'drBody');
  ctx.restore();
}

function layer(r, name) {
  const l = r.layers && r.layers.get(name);
  if (l) r.ctx.drawImage(l.cv, l.x, l.y, l.w, l.h);
}

/** Geschlossene Lider über die Augen der Kopfebene legen. */
function sleepyEyes(ctx) {
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#7a5bd6';
    ctx.beginPath();
    ctx.ellipse(s * 40, 44, 21, 17, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,8,48,0.8)';
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(s * 40, 38, 16, 0.24, Math.PI - 0.24);
    ctx.stroke();
    // Wimpern
    ctx.lineWidth = 2.2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(s * 40 + i * 9, 52 + Math.abs(i) * -2);
      ctx.lineTo(s * 40 + i * 11, 60 + Math.abs(i) * -2);
      ctx.stroke();
    }
  }
}

/** Staunen: weit aufgerissene Pupillen. */
function wideEyes(ctx) {
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#190834';
    ctx.beginPath();
    ctx.ellipse(s * 40, 44, 8.5, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(s * 42, 39, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Aufsteigende Funken aus den Nüstern. */
function breathSparks(ctx, x, y, t, n) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const ph = (t * 1.6 + i / n) % 1;
    const px = x + Math.sin(i * 2.1 + ph * 5) * (14 + i * 5);
    const py = y - ph * (70 + i * 16);
    ctx.fillStyle = `rgba(255,${200 + (i % 3) * 18},140,${0.6 * (1 - ph)})`;
    ctx.beginPath();
    ctx.arc(px, py, 1.6 + (1 - ph) * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// =============================================================================
//  Kulissen — einmal je Tafel und Maßstab gebacken
// =============================================================================

function sceneryFor(r, index) {
  const s = r.spriteScale || 1;
  if (Math.abs(sceneryScale - s) > 0.01) {
    scenery.clear();
    sceneryScale = s;
  }
  let cv = scenery.get(index);
  if (cv) return cv;

  cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(VW * s));
  cv.height = Math.max(1, Math.ceil(VH * s));
  const g = cv.getContext('2d');
  g.setTransform(s, 0, 0, s, 0, 0);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // drawStone zeichnet in r.ctx — für die Backphase wird der Kontext kurz
  // umgehängt. Danach steht wieder alles wie zuvor.
  const prev = r.ctx;
  r.ctx = g;
  try {
    BACKDROPS[index](g, r);
  } finally {
    r.ctx = prev;
  }
  scenery.set(index, cv);
  return cv;
}

const BACKDROPS = [
  // --- 1 ---------------------------------------------------------------------
  (g, r) => {
    cave(g, '#1d1236', '#080513', 0.5);
    ceiling(g, 0, 150, true);
    spires(g, seeded(11), 8, 0.55);
    floor(g, '#170f2c');
    // leerer Boden, ein paar Staubkörner
    const rnd = seeded(77);
    g.fillStyle = 'rgba(190,168,255,0.16)';
    for (let i = 0; i < 60; i++) {
      g.beginPath();
      g.arc(rnd() * VW, 620 + rnd() * 330, 0.8 + rnd() * 1.8, 0, Math.PI * 2);
      g.fill();
    }
    // Leere Decke: nur Fels, kein einziger Stein
    void r;
  },

  // --- 2 ---------------------------------------------------------------------
  (g, r) => {
    cave(g, '#241541', '#0a0618', 0.62);
    ceiling(g, 0, 132, false);
    spires(g, seeded(23), 6, 0.4);
    floor(g, '#1a1132');
    // Ein paar Steine kleben schon oben
    r.drawStone(1, 268, 176, { scale: 0.92, alpha: 0.9 });
    r.drawStone(3, 452, 168, { scale: 0.86, alpha: 0.85 });
    glowSpot(g, 360, 150, 220, 'rgba(255,200,120,0.10)');
  },

  // --- 3 ---------------------------------------------------------------------
  (g, r) => {
    cave(g, '#1f1440', '#080514', 0.55);
    ceiling(g, 0, 96, false);
    // Volle Decke: sechs Reihen im Sechseckraster, nach unten ausdünnend
    const rnd = seeded(5);
    const D = 60, RH = 52;
    for (let row = 0; row < 6; row++) {
      const odd = row % 2;
      const cols = odd ? 10 : 11;
      for (let c = 0; c < cols; c++) {
        if (row > 2 && rnd() < row * 0.16) continue;
        const x = 42 + c * D + odd * (D / 2);
        const y = 118 + row * RH;
        r.drawStone((row * 3 + c * 2 + (rnd() * 2 | 0)) % 5, x, y, { scale: 0.92 });
      }
    }
    glowSpot(g, 360, 240, 380, 'rgba(180,150,255,0.12)');
    spires(g, seeded(31), 6, 0.4);
    floor(g, '#18102f');
  },

  // --- 4 ---------------------------------------------------------------------
  (g, r) => {
    cave(g, '#2a1338', '#0a0512', 0.6);
    ceiling(g, 0, 96, false);
    // Rest der Decke, mit einem Loch dort, wo es gleich kracht
    const rnd = seeded(9);
    const D = 60, RH = 52;
    for (let row = 0; row < 4; row++) {
      const odd = row % 2;
      const cols = odd ? 10 : 11;
      for (let c = 0; c < cols; c++) {
        const x = 42 + c * D + odd * (D / 2);
        const y = 118 + row * RH;
        if (Math.hypot(x - 352, y - 300) < 138) continue;
        if (row === 3 && rnd() < 0.4) continue;
        r.drawStone((row + c * 3 + (rnd() * 2 | 0)) % 5, x, y, { scale: 0.92, alpha: 0.95 });
      }
    }
    spires(g, seeded(43), 6, 0.4);
    floor(g, '#1b1030');
    hoard(g, 0.35);
  },

  // --- 5 ---------------------------------------------------------------------
  (g, r) => {
    cave(g, '#2a1c3e', '#0b0716', 0.7);
    ceiling(g, 0, 90, false);
    spires(g, seeded(67), 7, 0.5);
    floor(g, '#1d1330');
    hoard(g, 1);
    // Schatzsteine, die schon liegen
    const rnd = seeded(101);
    for (let i = 0; i < 26; i++) {
      const x = 60 + rnd() * 600;
      const y = 906 + rnd() * 74;
      r.drawStone((rnd() * 5) | 0, x, y, { scale: 0.42 + rnd() * 0.22, alpha: 0.9 });
    }
    glowSpot(g, 360, 930, 400, 'rgba(255,196,110,0.13)');
  },
];

// --- Kulissenbausteine -------------------------------------------------------

function cave(g, top, bottom, vignette) {
  const sky = g.createLinearGradient(0, 0, 0, VH);
  sky.addColorStop(0, top);
  sky.addColorStop(0.55, mixHex(top, bottom, 0.65));
  sky.addColorStop(1, bottom);
  g.fillStyle = sky;
  g.fillRect(0, 0, VW, VH);

  const v = g.createRadialGradient(VW / 2, VH * 0.42, VW * 0.3, VW / 2, VH * 0.42, VH * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${vignette})`);
  g.fillStyle = v;
  g.fillRect(0, 0, VW, VH);
}

/** Höhlendecke mit Zacken und Stalaktiten. */
function ceiling(g, y0, h, longTeeth) {
  const rnd = seeded(1234 + h);
  const rock = g.createLinearGradient(0, y0, 0, y0 + h);
  rock.addColorStop(0, '#120b22');
  rock.addColorStop(1, '#2b1c4c');
  g.fillStyle = rock;
  g.beginPath();
  g.moveTo(0, y0);
  g.lineTo(VW, y0);
  g.lineTo(VW, y0 + h * 0.55);
  for (let i = 18; i >= 0; i--) {
    const x = (i / 18) * VW;
    g.lineTo(x, y0 + h * 0.55 - (i % 2 ? 0 : 10 + rnd() * 18));
  }
  g.closePath();
  g.fill();

  const n = longTeeth ? 20 : 14;
  for (let i = 0; i < n; i++) {
    const x = rnd() * VW;
    const len = (longTeeth ? 40 : 22) + rnd() * (longTeeth ? 130 : 70);
    const w = 8 + rnd() * 18;
    const gr = g.createLinearGradient(x, y0 + h * 0.4, x, y0 + h * 0.55 + len);
    gr.addColorStop(0, '#3a2760');
    gr.addColorStop(1, '#0d0719');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x - w, y0 + h * 0.4);
    g.lineTo(x + w, y0 + h * 0.4);
    g.lineTo(x + w * 0.2, y0 + h * 0.55 + len);
    g.closePath();
    g.fill();
    if (rnd() > 0.6) {
      g.fillStyle = 'rgba(170,140,255,0.5)';
      g.beginPath();
      g.arc(x + w * 0.2, y0 + h * 0.55 + len - 4, 2.6 + rnd() * 2, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** Kristallzacken am Boden, links und rechts. */
function spires(g, rnd, n, alpha) {
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : 0;
    const x = side ? VW - 30 - rnd() * 190 : 30 + rnd() * 190;
    const h = 150 + rnd() * 330;
    const w = 26 + rnd() * 48;
    const gr = g.createLinearGradient(x - w, 1010, x + w * 0.4, 1010 - h);
    gr.addColorStop(0, `rgba(46,30,86,${alpha})`);
    gr.addColorStop(1, `rgba(148,120,236,${alpha * 0.75})`);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x - w, 1010);
    g.lineTo(x - w * 0.5, 1010 - h * 0.72);
    g.lineTo(x, 1010 - h);
    g.lineTo(x + w * 0.62, 1010 - h * 0.58);
    g.lineTo(x + w, 1010);
    g.closePath();
    g.fill();
    g.strokeStyle = `rgba(220,200,255,${alpha * 0.4})`;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x - w * 0.5, 1010 - h * 0.72);
    g.lineTo(x, 1010 - h);
    g.lineTo(x + w * 0.62, 1010 - h * 0.58);
    g.stroke();
  }
}

function floor(g, color) {
  const rnd = seeded(555);
  const gr = g.createLinearGradient(0, 880, 0, VH);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(0.35, color);
  gr.addColorStop(1, '#07040e');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(0, VH);
  g.lineTo(0, 946);
  for (let x = 0; x <= VW; x += 60) {
    g.quadraticCurveTo(x + 30, 926 - rnd() * 26, x + 60, 942 - rnd() * 14);
  }
  g.lineTo(VW, VH);
  g.closePath();
  g.fill();
}

/**
 * Schatzberg. Bewusst dunkel: Er ist Rahmen, nicht Blickfang, und darf die
 * Texttafel darüber nicht überstrahlen. Glanzpunkte gibt es nur an der Krone.
 */
function hoard(g, amount) {
  const rnd = seeded(808);
  const top = 990 - amount * 84;
  const gr = g.createLinearGradient(0, top - 20, 0, VH);
  gr.addColorStop(0, '#4a3110');
  gr.addColorStop(0.3, '#241708');
  gr.addColorStop(1, '#0a0603');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(0, VH);
  g.lineTo(0, top + 40);
  for (let x = 0; x <= VW; x += 48) {
    const bulge = 1 - Math.abs(x - 360) / 420;
    g.quadraticCurveTo(x + 24, top + 22 - bulge * 46 - rnd() * 20,
      x + 48, top + 34 - bulge * 34 - rnd() * 12);
  }
  g.lineTo(VW, VH);
  g.closePath();
  g.fill();

  // Münzen nur im oberen Saum, wo das Licht hinfällt
  for (let i = 0; i < 110 * amount; i++) {
    const x = rnd() * VW;
    const bulge = 1 - Math.abs(x - 360) / 420;
    const crest = top + 22 - bulge * 38;
    const d = rnd() * rnd() * 150;
    const rad = 3 + rnd() * 5.5;
    const fade = 1 - d / 170;
    g.fillStyle = rnd() > 0.8
      ? `rgba(180,152,244,${0.16 + fade * 0.3})`
      : `rgba(226,178,84,${0.16 + fade * 0.36})`;
    g.beginPath();
    g.ellipse(x, crest + 8 + d, rad, rad * 0.6, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }

  // Alles unterhalb der Texttafel wieder wegdunkeln
  const dim = g.createLinearGradient(0, top + 90, 0, VH);
  dim.addColorStop(0, 'rgba(6,3,12,0)');
  dim.addColorStop(1, 'rgba(6,3,12,0.85)');
  g.fillStyle = dim;
  g.fillRect(0, top + 90, VW, VH - top - 90);
}

/**
 * Vordergrundkante: verdeckt die abgeschnittene Unterseite der Drachenfigur
 * und setzt sie in den Boden. Wird live gezeichnet, weil sie vor dem Drachen
 * liegt — ein Pfad und ein Lichtsaum, mehr nicht.
 */
function ridge(ctx, y, warm) {
  const rnd = seeded(303 + (y | 0));
  const gr = ctx.createLinearGradient(0, y - 16, 0, y + 130);
  gr.addColorStop(0, warm ? '#3d280d' : '#1d1433');
  gr.addColorStop(1, warm ? '#0b0603' : '#080512');
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.moveTo(-10, VH + 10);
  ctx.lineTo(-10, y + 16);
  for (let x = -10; x <= VW + 10; x += 56) {
    ctx.quadraticCurveTo(x + 28, y - 10 - rnd() * 20, x + 56, y + 8 - rnd() * 14);
  }
  ctx.lineTo(VW + 10, VH + 10);
  ctx.closePath();
  ctx.fill();

  const rnd2 = seeded(303 + (y | 0));
  ctx.strokeStyle = warm ? 'rgba(255,206,132,0.34)' : 'rgba(186,162,255,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-10, y + 16);
  for (let x = -10; x <= VW + 10; x += 56) {
    ctx.quadraticCurveTo(x + 28, y - 10 - rnd2() * 20, x + 56, y + 8 - rnd2() * 14);
  }
  ctx.stroke();

  // Münzen auf der Kante — nur beim Schatz, nicht beim nackten Höhlenboden
  if (!warm) return;
  const rnd3 = seeded(707 + (y | 0));
  for (let i = 0; i < 44; i++) {
    const x = rnd3() * VW;
    const d = rnd3() * rnd3() * 88;
    const rad = 3 + rnd3() * 5;
    ctx.fillStyle = rnd3() > 0.82
      ? `rgba(190,164,250,${0.2 + (1 - d / 100) * 0.3})`
      : `rgba(240,196,104,${0.18 + (1 - d / 100) * 0.34})`;
    ctx.beginPath();
    ctx.ellipse(x, y + 8 + d, rad, rad * 0.6, rnd3() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function glowSpot(g, x, y, rad, color) {
  const gl = g.createRadialGradient(x, y, 8, x, y, rad);
  gl.addColorStop(0, color);
  gl.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gl;
  g.beginPath();
  g.arc(x, y, rad, 0, Math.PI * 2);
  g.fill();
}

// --- Hilfen ------------------------------------------------------------------

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** Weiches Ein- und Ausschwingen für den Einblendfortschritt. */
function ease(t) { return t * t * (3 - 2 * t); }

function mixHex(a, b, t) {
  const pa = parseInt(a.replace('#', ''), 16);
  const pb = parseInt(b.replace('#', ''), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const c = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | c).toString(16).slice(1)}`;
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
