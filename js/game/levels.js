/**
 * Levels: feste, wiederholbare Layouts aus data/levels.json.
 *
 * Ein Layout ist eine Liste von Zeichenketten, eine je Rasterreihe:
 *   Ziffer 0..4 = Farbindex, '.' = leeres Feld.
 * Gerade Reihen haben 11 Zeichen, ungerade 10.
 *
 * Fällt das Laden aus (z. B. Aufruf über file://), springt ein eingebettetes
 * Grundpaket ein, damit das Spiel niemals mit leerem Feld startet.
 */
import { Grid, makeStone } from './grid.js';
import { BIOMES, MAX_COLORS } from './config.js';

/** Kleiner, schneller, deterministischer PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Notfall-Layouts, falls data/levels.json nicht erreichbar ist. */
const FALLBACK = {
  version: 1,
  levels: [
    {
      id: 'kh-01', biome: 0, name: 'Erste Funken', colors: 3,
      rows: [
        '00011122200',
        '0011122200',
        '11122200011',
        '1122200011',
        '22200011122',
      ],
    },
    {
      id: 'kh-02', biome: 0, name: 'Kristallgitter', colors: 3,
      rows: [
        '01010101010',
        '2020202020',
        '12121212121',
        '0101010101',
        '20202020202',
        '1212121212',
      ],
    },
  ],
};

let cache = null;

/**
 * Lädt und prüft die Leveldaten.
 * @param {string} url
 */
export async function loadLevels(url = 'data/levels.json') {
  if (cache) return cache;
  let data = null;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.ok) data = await res.json();
  } catch {
    data = null;
  }
  if (!data || !Array.isArray(data.levels) || data.levels.length === 0) {
    data = FALLBACK;
  }
  cache = data;
  return data;
}

/** Level nach Index, mit Umlauf, damit nie ins Leere gegriffen wird. */
export function levelAt(data, index) {
  const list = data.levels;
  return list[((index % list.length) + list.length) % list.length];
}

export function biomeOf(level) {
  return BIOMES[Math.min(level.biome ?? 0, BIOMES.length - 1)];
}

/**
 * Baut ein Raster aus einem Layout.
 * Zeilen, die nicht zur Feldzahl der Reihe passen, werden gekürzt bzw. mit
 * leeren Feldern aufgefüllt — ein Tippfehler in den Daten darf das Spiel
 * nicht abstürzen lassen.
 * @param {object} level
 * @returns {Grid}
 */
export function buildGrid(level) {
  const grid = new Grid();
  const rows = level.rows || [];
  for (let r = 0; r < rows.length; r++) {
    const line = String(rows[r]);
    const cols = grid.colsIn(r);
    for (let c = 0; c < cols; c++) {
      const ch = line[c];
      if (!ch || ch === '.' || ch === ' ') continue;
      const idx = Number.parseInt(ch, 10);
      if (Number.isNaN(idx)) continue;
      grid.rows[r][c] = makeStone(idx % MAX_COLORS);
    }
  }
  grid.normalize();
  return grid;
}

/**
 * Farben, die ein Level benutzt — Grundlage für die Nachschubreihen.
 * @returns {number[]}
 */
export function levelColors(level, grid) {
  const present = grid.presentColors();
  if (present.length) return present;
  const n = Math.max(1, Math.min(level.colors || 3, MAX_COLORS));
  return Array.from({ length: n }, (_, i) => i);
}
