/**
 * Farbgruppen und Erreichbarkeit.
 *
 * Zwei Fragen, in dieser Reihenfolge:
 *  1. Bilden 3 oder mehr gleichfarbige, verbundene Steine eine Gruppe? -> entfernen
 *  2. Was hängt danach nicht mehr an der obersten Reihe? -> stürzt ab
 */
import { MATCH_MIN } from './config.js';

/** Steine, die grundsätzlich an einer Farbgruppe teilnehmen können. */
function matchable(stone) {
  return !!stone && stone.kind === 'gem';
}

/**
 * Zusammenhängende gleichfarbige Gruppe ab (row, col).
 * @returns {Array<[number,number]>} Feldkoordinaten der Gruppe
 */
export function findCluster(grid, row, col) {
  const start = grid.get(row, col);
  if (!matchable(start)) return [];

  const seen = new Set([key(row, col)]);
  const stack = [[row, col]];
  const out = [];

  while (stack.length) {
    const [r, c] = stack.pop();
    out.push([r, c]);
    for (const [nr, nc] of grid.neighbors(r, c)) {
      const k = key(nr, nc);
      if (seen.has(k)) continue;
      const s = grid.get(nr, nc);
      if (!matchable(s) || s.color !== start.color) continue;
      seen.add(k);
      stack.push([nr, nc]);
    }
  }
  return out;
}

/** Gruppe groß genug zum Entfernen? */
export function isMatch(cluster) {
  return cluster.length >= MATCH_MIN;
}

/**
 * Alle Steine, die von der obersten Reihe aus nicht mehr erreichbar sind.
 * Sortiert von oben nach unten, damit die Punktvergabe (20 * n) reproduzierbar ist.
 * @returns {Array<[number,number]>}
 */
export function findFloating(grid) {
  const anchored = new Set();
  const stack = [];

  // Verankert ist alles, was an der Decke (Reihe 0) hängt.
  const cols = grid.colsIn(0);
  for (let c = 0; c < cols; c++) {
    if (grid.get(0, c)) {
      anchored.add(key(0, c));
      stack.push([0, c]);
    }
  }

  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [nr, nc] of grid.neighbors(r, c)) {
      const k = key(nr, nc);
      if (anchored.has(k) || !grid.get(nr, nc)) continue;
      anchored.add(k);
      stack.push([nr, nc]);
    }
  }

  const loose = [];
  grid.forEach((_s, r, c) => {
    if (!anchored.has(key(r, c))) loose.push([r, c]);
  });
  loose.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  return loose;
}

function key(r, c) { return r * 100 + c; }
