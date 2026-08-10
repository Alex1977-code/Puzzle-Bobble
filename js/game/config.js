/**
 * Drachenfunke — zentrale Spielkonstanten.
 * Sämtliche Werte sind virtuelle Einheiten (720 x 1280), niemals Bildschirm-Pixel.
 */

// --- Virtuelle Auflösung -----------------------------------------------------
export const VW = 720;
export const VH = 1280;

// --- Hex-Raster --------------------------------------------------------------
export const R = 32;                       // Steinradius
export const D = R * 2;                    // Spaltenabstand
export const ROW_HEIGHT = R * Math.sqrt(3); // Reihenhöhe = r * sqrt(3) = 55,4256...

export const COLS_EVEN = 11;               // gerade Reihen: 11 Steine
export const COLS_ODD = 10;                // ungerade Reihen: 10 Steine, um r nach rechts versetzt

// Spielfeld waagerecht mittig: 11 * 64 = 704 von 720 => 8 px Rand je Seite.
export const PLAY_LEFT = (VW - COLS_EVEN * D) / 2;    // 8
export const PLAY_RIGHT = PLAY_LEFT + COLS_EVEN * D;  // 712

export const CEILING_Y = 56;               // Unterkante der Höhlendecke
export const FAIL_Y = 1000;                // Fail-Linie
export const MIN_ROWS = 18;                // stets vorgehaltene Rasterreihen

// --- Schleuder / Schuss ------------------------------------------------------
export const SHOOTER_X = 360;
export const SHOOTER_Y = 1150;
export const MAX_ANGLE = 78;               // Grad von der Senkrechten
export const SHOT_SPEED = 1600;            // px/s
export const MAX_SUBSTEP = 4;              // px je Kollisions-Substep
export const COLLIDE_DIST = R * 1.9;       // Trefferabstand Mittelpunkt-zu-Mittelpunkt

// --- Steuerung ---------------------------------------------------------------
export const AIM_SENSITIVITY = 0.18;       // Grad je gezogenem px
export const TAP_MS = 150;
export const TAP_PX = 10;
export const CANCEL_ZONE_Y = VH * 0.85;    // untere 15 % brechen den Schuss ab
export const SHOOTER_TAP_RADIUS = 78;      // Tipp-Fläche zum Tauschen der Warteschlange

// --- Vorschau ----------------------------------------------------------------
export const PREVIEW_DOT_SPACING = 24;
export const PREVIEW_MAX_BOUNCES = 1;      // gepunktete Linie mit genau einer Wandbande

// --- Regeln ------------------------------------------------------------------
export const MATCH_MIN = 3;
export const MISS_LIMIT = 5;               // Fehlschüsse bis zur Nachschubreihe
export const ROW_PUSH_MS = 300;
export const SCORE_POP = 10;
export const SCORE_DROP_STEP = 20;         // n-ter abgestürzter Stein: 20 * n
export const COMBO_MULT = [1, 1.25, 1.5, 2];
export const RESTART_MS = 350;             // Scheitern -> neuer Versuch, < 400 ms

// --- Absturz-Physik ----------------------------------------------------------
export const GRAVITY = 2200;               // px/s^2
export const DROP_DRIFT = 70;              // maximale Zufallsdrift in x, px/s
export const DROP_SPIN = 5.5;              // maximale Drehgeschwindigkeit, rad/s
export const DROP_KILL_Y = VH + 120;

// --- Farben ------------------------------------------------------------------
// Jede Farbe trägt zusätzlich ein eigenes Symbol (Farbfehlsichtigkeit).
export const COLORS = [
  { key: 'rubin',    name: 'Rubin',    base: '#ff3a5e', light: '#ffb3c2', dark: '#7d0a24', symbol: 'circle' },
  { key: 'smaragd',  name: 'Smaragd',  base: '#25d97a', light: '#a9f6c9', dark: '#075c33', symbol: 'diamond' },
  { key: 'saphir',   name: 'Saphir',   base: '#3d9dff', light: '#b3d9ff', dark: '#0a3576', symbol: 'triangle' },
  { key: 'bernstein',name: 'Bernstein',base: '#ffc02e', light: '#ffe9a8', dark: '#7d4f00', symbol: 'star' },
  { key: 'amethyst', name: 'Amethyst', base: '#b558ff', light: '#e3c1ff', dark: '#3f0d75', symbol: 'wave' },
];
export const MAX_COLORS = COLORS.length;

// --- Biome (Hintergründe; Inhalte folgen in Meilenstein 4) -------------------
export const BIOMES = [
  { key: 'kristallhoehle', name: 'Kristallhöhle', sky: ['#1b1030', '#0a0618'], rock: '#2c1c4a', glow: '#7d5cff' },
  { key: 'pilzwald',       name: 'Pilzwald',      sky: ['#0f2418', '#050f0a'], rock: '#1d4030', glow: '#4cff9d' },
  { key: 'lavaschmiede',   name: 'Lavaschmiede',  sky: ['#2e0e08', '#140503'], rock: '#4a1a10', glow: '#ff6a2a' },
  { key: 'eisdom',         name: 'Eisdom',        sky: ['#0d2338', '#040d16'], rock: '#1b4260', glow: '#7fd8ff' },
  { key: 'wolkenzitadelle',name: 'Wolkenzitadelle',sky: ['#221a3a', '#0b0818'], rock: '#3a3060', glow: '#ffd06a' },
];
