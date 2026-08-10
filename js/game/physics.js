/**
 * Flugbahn und Absturz.
 *
 * `traceShot` ist die einzige Wahrheit über die Schussphysik. Sowohl der echte
 * Schuss als auch die Flugbahn-Vorschau benutzen *dieselbe* Funktion mit
 * denselben Eingaben — Vorschau und Physik können deshalb prinzipiell nicht
 * auseinanderlaufen.
 */
import {
  R, PLAY_LEFT, PLAY_RIGHT, CEILING_Y, VH,
  MAX_SUBSTEP, COLLIDE_DIST, GRAVITY, DROP_DRIFT, DROP_SPIN, HOARD_Y,
} from './config.js';

const MIN_X = PLAY_LEFT + R;
const MAX_X = PLAY_RIGHT - R;
const MAX_TRACE_STEPS = 6000;   // ~24 000 px Flugweg, reichlich Reserve

/**
 * @typedef {{x:number,y:number}} Pt
 * @typedef {{points:Pt[], bounceAt:number[], length:number,
 *            hit:('ceiling'|[number,number]|null), cell:[number,number]|null}} Trace
 */

/**
 * Simuliert einen Schuss in Substeps von maximal 4 px.
 * @param {import('./grid.js').Grid} grid
 * @param {number} sx @param {number} sy
 * @param {number} angleDeg Grad von der Senkrechten, positiv = rechts
 * @returns {Trace}
 */
export function traceShot(grid, sx, sy, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  let dx = Math.sin(a);
  let dy = -Math.cos(a);
  let x = sx, y = sy;

  const points = [{ x, y }];
  const bounceAt = [];
  let hit = null;

  for (let step = 0; step < MAX_TRACE_STEPS; step++) {
    const px = x, py = y;
    x += dx * MAX_SUBSTEP;
    y += dy * MAX_SUBSTEP;

    // --- Wandkollision: x-Geschwindigkeit spiegeln, Knickpunkt exakt setzen ---
    if (x < MIN_X || x > MAX_X) {
      const wall = x < MIN_X ? MIN_X : MAX_X;
      const t = (wall - px) / dx;                 // Weg bis zur Wand
      const by = py + dy * t;
      points.push({ x: wall, y: by });
      bounceAt.push(points.length - 1);
      const rest = MAX_SUBSTEP - t;
      dx = -dx;
      x = wall + dx * rest;
      y = by + dy * rest;
    }

    // --- Decke ---
    if (y - R <= CEILING_Y) {
      y = CEILING_Y + R;
      hit = 'ceiling';
      points.push({ x, y });
      break;
    }

    // --- Steine ---
    const cell = nearestHit(grid, x, y);
    if (cell) {
      hit = cell;
      points.push({ x, y });
      break;
    }

    // Sicherheitsnetz: nach unten aus dem Bild ist kein gültiger Schuss.
    if (y > VH + 200) break;
  }

  const target = hit ? resolveSnap(grid, x, y, hit) : null;
  if (target) {
    const tx = grid.cellX(target[0], target[1]);
    const ty = grid.cellY(target[0]);
    const last = points[points.length - 1];
    if (Math.hypot(tx - last.x, ty - last.y) > 0.5) points.push({ x: tx, y: ty });
  }

  return { points, bounceAt, length: polylineLength(points), hit, cell: target };
}

/** Nächstgelegener belegter Nachbar innerhalb des Trefferabstands. */
function nearestHit(grid, x, y) {
  const rc = grid.rowAtY(y);
  const r0 = Math.max(0, rc - 2);
  const r1 = Math.min(grid.rows.length - 1, rc + 2);
  let best = null, bestD = COLLIDE_DIST * COLLIDE_DIST;

  for (let r = r0; r <= r1; r++) {
    const cols = grid.colsIn(r);
    const cc = grid.colAtX(r, x);
    const c0 = Math.max(0, cc - 2);
    const c1 = Math.min(cols - 1, cc + 2);
    const cy = grid.cellY(r);
    for (let c = c0; c <= c1; c++) {
      if (!grid.get(r, c)) continue;
      const ddx = x - grid.cellX(r, c);
      const ddy = y - cy;
      const d = ddx * ddx + ddy * ddy;
      if (d < bestD) { bestD = d; best = [r, c]; }
    }
  }
  return best;
}

/**
 * Nächstgelegenes freies Rasterfeld, das an den Treffer angrenzt.
 * @returns {[number,number]|null}
 */
function resolveSnap(grid, x, y, hit) {
  let best = null, bestD = Infinity;
  const consider = (r, c) => {
    if (!grid.isFree(r, c)) return;
    const ddx = x - grid.cellX(r, c);
    const ddy = y - grid.cellY(r);
    const d = ddx * ddx + ddy * ddy;
    if (d < bestD) { bestD = d; best = [r, c]; }
  };

  if (hit === 'ceiling') {
    const cols = grid.colsIn(0);
    for (let c = 0; c < cols; c++) consider(0, c);
  } else {
    for (const [nr, nc] of grid.neighbors(hit[0], hit[1])) consider(nr, nc);
  }
  if (best) return best;

  // Rückfall: irgendein freies Feld, das an einen Stein grenzt oder an der Decke hängt.
  for (let r = 0; r < grid.rows.length; r++) {
    const cols = grid.colsIn(r);
    for (let c = 0; c < cols; c++) {
      if (!grid.isFree(r, c)) continue;
      const attached = r === 0 || grid.neighbors(r, c).some(([nr, nc]) => grid.get(nr, nc));
      if (attached) consider(r, c);
    }
  }
  return best;
}

export function polylineLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

/** Punkt auf der Polylinie in Abstand `dist` vom Start. */
export function pointAtDistance(points, dist) {
  if (points.length === 0) return { x: 0, y: 0 };
  if (dist <= 0) return { ...points[0] };
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
  return { ...points[points.length - 1] };
}

// --- Abstürzende Steine -------------------------------------------------------

/**
 * Schwerkraft, leichte Zufallsdrift in x, Rotation. Unten versinken die Steine
 * im Hort und lösen dort den Funkenregen aus.
 */
export class FallingStones {
  /**
   * @param {()=>number} rng
   * @param {(x:number,y:number,color:number)=>void} onHoard Aufschlag im Hort
   */
  constructor(rng = Math.random, onHoard = null) {
    /** @type {Array<{x:number,y:number,vx:number,vy:number,rot:number,spin:number,color:number,kind:string}>} */
    this.items = [];
    this.rng = rng;
    this.onHoard = onHoard;
  }

  spawn(x, y, color, kind = 'gem', order = 0) {
    this.items.push({
      x, y,
      vx: (this.rng() * 2 - 1) * DROP_DRIFT,
      vy: -40 - this.rng() * 60 + order * 4,   // kurzer Aufwärtsimpuls, gestaffelt
      rot: (this.rng() * 2 - 1) * 0.4,
      spin: (this.rng() * 2 - 1) * DROP_SPIN,
      color, kind,
    });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const s = this.items[i];
      s.vy += GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.spin * dt;
      // An den Seitenwänden abprallen, damit nichts seitlich davonsegelt.
      if (s.x < MIN_X) { s.x = MIN_X; s.vx = Math.abs(s.vx) * 0.6; }
      if (s.x > MAX_X) { s.x = MAX_X; s.vx = -Math.abs(s.vx) * 0.6; }
      // Im Hort am unteren Rand versinken die Steine — mit Funkenregen.
      if (s.y > HOARD_Y) {
        if (this.onHoard) this.onHoard(s.x, HOARD_Y, s.color);
        this.items.splice(i, 1);
      }
    }
  }

  clear() { this.items.length = 0; }
  get count() { return this.items.length; }
}
