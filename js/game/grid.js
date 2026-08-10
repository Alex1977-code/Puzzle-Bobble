/**
 * Hex-Raster mit versetzten Reihen.
 *
 * Gerade Reihen: 11 Felder, linksbündig.
 * Ungerade Reihen: 10 Felder, um r = 32 px nach rechts versetzt.
 *
 * Schiebt eine Nachschubreihe von oben nach, rutscht das gesamte Feld um eine
 * Reihe nach unten. Damit wechselt der Versatz jeder Reihe *nicht* — statt die
 * Reihen umzuindizieren, kippt `parityShift`. So behält jede bestehende Reihe
 * ihren Versatz und ihre Feldzahl, und nur die neue Kopfreihe verzahnt sich.
 */
import {
  R, D, ROW_HEIGHT, COLS_EVEN, COLS_ODD, PLAY_LEFT,
  CEILING_Y, FAIL_Y, MIN_ROWS, COLORS,
} from './config.js';

/** Ein Stein im Raster. `kind` ist ab Meilenstein 4 für Hindernisse vorgesehen. */
export function makeStone(color, kind = 'gem') {
  return { color, kind };
}

export class Grid {
  constructor() {
    /** @type {(null|{color:number,kind:string})[][]} */
    this.rows = [];
    this.parityShift = 0;
    /** 1 -> 0 während der 300-ms-Nachschubanimation (rein optisch). */
    this.pushAnim = 0;
    this.normalize();
  }

  // --- Geometrie -------------------------------------------------------------

  /** 0 = gerade Reihe (11 Felder), 1 = ungerade Reihe (10 Felder, +32 px). */
  parityOf(row) { return (row + this.parityShift) & 1; }

  colsIn(row) { return this.parityOf(row) === 0 ? COLS_EVEN : COLS_ODD; }

  cellX(row, col) {
    return PLAY_LEFT + R + (this.parityOf(row) === 1 ? R : 0) + col * D;
  }

  cellY(row) {
    return CEILING_Y + R + row * ROW_HEIGHT;
  }

  /** Optische y-Position inklusive laufender Nachschubanimation. */
  drawY(row) {
    return this.cellY(row) - this.pushAnim * ROW_HEIGHT;
  }

  inBounds(row, col) {
    return row >= 0 && row < this.rows.length && col >= 0 && col < this.colsIn(row);
  }

  // --- Zugriff ---------------------------------------------------------------

  get(row, col) {
    if (!this.inBounds(row, col)) return null;
    return this.rows[row][col] || null;
  }

  set(row, col, stone) {
    if (!this.inBounds(row, col)) return;
    this.rows[row][col] = stone;
    if (stone) this.normalize();
  }

  isFree(row, col) {
    return this.inBounds(row, col) && !this.rows[row][col];
  }

  /** Stein entfernen und zurückgeben. */
  remove(row, col) {
    if (!this.inBounds(row, col)) return null;
    const s = this.rows[row][col] || null;
    this.rows[row][col] = null;
    return s;
  }

  /**
   * Die sechs Nachbarn im versetzten Raster.
   * Gerade Reihe: oben/unten liegen bei col-1 und col.
   * Ungerade Reihe: oben/unten liegen bei col und col+1.
   */
  neighbors(row, col) {
    const shift = this.parityOf(row) === 0 ? -1 : 0;
    const out = [];
    const cand = [
      [row, col - 1], [row, col + 1],
      [row - 1, col + shift], [row - 1, col + shift + 1],
      [row + 1, col + shift], [row + 1, col + shift + 1],
    ];
    for (const [r, c] of cand) {
      if (this.inBounds(r, c)) out.push([r, c]);
    }
    return out;
  }

  forEach(fn) {
    for (let r = 0; r < this.rows.length; r++) {
      const cols = this.colsIn(r);
      for (let c = 0; c < cols; c++) {
        const s = this.rows[r][c];
        if (s) fn(s, r, c);
      }
    }
  }

  // --- Struktur --------------------------------------------------------------

  lastOccupiedRow() {
    for (let r = this.rows.length - 1; r >= 0; r--) {
      const cols = this.colsIn(r);
      for (let c = 0; c < cols; c++) if (this.rows[r][c]) return r;
    }
    return -1;
  }

  isEmpty() { return this.lastOccupiedRow() === -1; }

  count() {
    let n = 0;
    this.forEach(() => n++);
    return n;
  }

  /** Reihenpuffer auf sinnvolle Länge bringen und fehlende Felder mit null füllen. */
  normalize() {
    const need = Math.max(MIN_ROWS, this.lastOccupiedRow() + 3);
    while (this.rows.length < need) this.rows.push([]);
    while (this.rows.length > need && this._rowEmpty(this.rows.length - 1)) this.rows.pop();
    for (let r = 0; r < this.rows.length; r++) {
      const cols = this.colsIn(r);
      const row = this.rows[r];
      for (let c = 0; c < cols; c++) if (row[c] === undefined) row[c] = null;
    }
  }

  _rowEmpty(r) {
    const row = this.rows[r];
    if (!row) return true;
    for (let c = 0; c < row.length; c++) if (row[c]) return false;
    return true;
  }

  /**
   * Neue Reihe von oben nachschieben. `fill(col)` liefert den Stein je Feld.
   * Bestehende Reihen behalten Versatz und Feldzahl, rücken aber eine Reihe tiefer.
   */
  pushRow(fill) {
    this.parityShift ^= 1;
    const cols = this.colsIn(0);          // Parität der *neuen* Kopfreihe
    const row = new Array(cols).fill(null);
    for (let c = 0; c < cols; c++) row[c] = fill(c) || null;
    this.rows.unshift(row);
    this.pushAnim = 1;
    this.normalize();
  }

  // --- Auswertung ------------------------------------------------------------

  /** Anzahl je Farbindex. */
  colorCounts() {
    const counts = new Array(COLORS.length).fill(0);
    this.forEach((s) => { if (s.kind === 'gem') counts[s.color]++; });
    return counts;
  }

  /** Farbindizes, die noch auf dem Feld liegen. */
  presentColors() {
    const counts = this.colorCounts();
    const out = [];
    for (let i = 0; i < counts.length; i++) if (counts[i] > 0) out.push(i);
    return out;
  }

  /** Tiefster Punkt eines Steins (Unterkante). */
  lowestEdge() {
    const r = this.lastOccupiedRow();
    return r < 0 ? CEILING_Y : this.cellY(r) + R;
  }

  /** Hat ein Stein die Fail-Linie überschritten? */
  crossedFailLine() {
    return this.lowestEdge() > FAIL_Y;
  }

  /** Nächstgelegene Rasterreihe zu einer y-Koordinate. */
  rowAtY(y) {
    return Math.round((y - CEILING_Y - R) / ROW_HEIGHT);
  }

  /** Nächstgelegene Spalte zu einer x-Koordinate in Reihe `row`. */
  colAtX(row, x) {
    const off = PLAY_LEFT + R + (this.parityOf(row) === 1 ? R : 0);
    return Math.round((x - off) / D);
  }
}
