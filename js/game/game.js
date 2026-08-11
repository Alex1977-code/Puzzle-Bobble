/**
 * Spielablauf: Zustand, Regeln, Eingabe-Semantik.
 *
 * Meilensteine 1 bis 3: Kern, Steuerung mit Vorschau, sowie Juice und Audio.
 */
import {
  VH, SHOOTER_X, SHOOTER_Y, SHOT_SPEED, CANCEL_ZONE_Y, TAP_MS, TAP_PX,
  MISS_LIMIT, ROW_PUSH_MS, SCORE_POP, SCORE_DROP_STEP, COMBO_MULT, RESTART_MS,
  ROW_HEIGHT, FAIL_Y, COMBO_LAYER_AT,
} from './config.js';
import { makeStone } from './grid.js';
import { Shooter } from './shooter.js';
import { traceShot, pointAtDistance, FallingStones } from './physics.js';
import { findCluster, isMatch, findFloating } from './match.js';
import { buildGrid, levelAt, biomeOf, mulberry32, hashString } from './levels.js';
import { Juice } from '../fx/juice.js';
import { AudioEngine } from '../core/audio.js';
import { Hud } from '../ui/hud.js';
import { STORY_PANELS, drawStoryPanel } from '../ui/story.js';

const STORY_KEY = 'drachenfunke.story';
const STORY_FADE = 0.45;   // s je Tafel bis zum Standbild

/** @typedef {'story'|'ready'|'flying'|'pushing'|'won'|'lost'} State */

export class Game {
  /**
   * @param {import('../core/render.js').Renderer} renderer
   * @param {{levels:Array<object>}} levelsData
   */
  constructor(renderer, levelsData) {
    this.r = renderer;
    this.data = levelsData;
    this.hud = new Hud(renderer);

    this.rng = Math.random;
    this.shooter = new Shooter(() => this.rng());

    /** Wird von main.js gesetzt; nötig fürs Hitstop. */
    this.loop = null;
    this.audio = new AudioEngine();
    this.juice = new Juice(
      () => this.rng(),
      (sec, scale) => this.loop && this.loop.hitstop(sec, scale),
    );
    this.falling = new FallingStones(
      () => this.rng(),
      (x, y, color) => this.juice.hoardSplash(x, y, color),
    );

    this.levelIndex = 0;
    this.score = 0;
    this.scoreAtLevelStart = 0;
    this.time = 0;

    /** @type {State} */
    this.state = 'ready';
    this.stateTimer = 0;

    this.comboStreak = 0;
    this.missStreak = 0;

    /** @type {{trace:object, dist:number, stone:object}|null} */
    this.projectile = null;
    this.trace = null;
    this._traceAngle = NaN;
    this._traceVersion = -1;
    this.gridVersion = 0;

    this.aimCancel = false;
    this.downOnShooter = false;
    this.downOnMute = false;
    this.recoil = 0;          // Rückstoß der Schleuder, 1 -> 0

    this.storyIndex = 0;
    this.storyT = 0;

    this.loadLevel(0);

    // Die Story läuft einmal je Browser, danach nie wieder ungefragt.
    if (!storySeen()) {
      this.state = 'story';
      this.storyT = 0;
    }
  }

  // --- Level ----------------------------------------------------------------

  loadLevel(index) {
    this.levelIndex = index;
    this.level = levelAt(this.data, index);
    this.biome = biomeOf(this.level);
    this.audio.setBiome(this.biome);
    this.scoreAtLevelStart = this.score;
    this.buildFromLevel();
  }

  /** Baut das Feld exakt aus den Leveldaten — identisch bei jedem Neustart. */
  buildFromLevel() {
    // Fester Startzustand des Zufallsgenerators je Level: gleiche Ausgangslage,
    // aber innerhalb einer Sitzung keine langweilige Wiederholung.
    const seed = hashString(`${this.level.id}#${this.restartCount || 0}`);
    const prng = mulberry32(seed);
    this.rng = prng;

    this.grid = buildGrid(this.level);
    this.grid.pushAnim = 0;
    this.gridVersion++;
    this.falling.clear();
    this.juice.reset();
    this.audio.setComboLayer(false);
    this.projectile = null;
    this.comboStreak = 0;
    this.missStreak = 0;
    this.state = 'ready';
    this.stateTimer = 0;
    this.aimCancel = false;
    this.shooter.reset(this.grid);
    this.invalidateTrace();
  }

  restartLevel() {
    this.restartCount = (this.restartCount || 0) + 1;
    this.score = this.scoreAtLevelStart;
    this.hud.shownScore = this.score;
    this.buildFromLevel();
  }

  nextLevel() {
    this.restartCount = 0;
    this.loadLevel(this.levelIndex + 1);
  }

  // --- Vorschau -------------------------------------------------------------

  invalidateTrace() {
    this._traceAngle = NaN;
    this._traceVersion = -1;
  }

  /**
   * Flugbahn für den aktuellen Winkel. Ergebnis wird gepuffert, solange sich
   * weder Winkel noch Feld ändern — die Vorschau nutzt exakt dieselbe Physik
   * wie der Schuss selbst.
   */
  computeTrace() {
    const ang = this.shooter.angle;
    if (this.trace && ang === this._traceAngle && this.gridVersion === this._traceVersion) {
      return this.trace;
    }
    const t = traceShot(this.grid, SHOOTER_X, SHOOTER_Y, ang);
    if (t.cell) {
      t.ghost = { x: this.grid.cellX(t.cell[0], t.cell[1]), y: this.grid.cellY(t.cell[0]) };
    }
    this.trace = t;
    this._traceAngle = ang;
    this._traceVersion = this.gridVersion;
    return t;
  }

  // --- Eingabe --------------------------------------------------------------

  /** @param {{type:string,x:number,y:number,dx:number,dy:number,duration:number,maxMove:number}} e */
  onPointer(e) {
    if (this.state === 'story') {
      if (e.type === 'down') this.audio.unlock();
      if (e.type === 'up') this.advanceStory();
      return;
    }
    if (this.state === 'lost') return;
    if (this.state === 'won') {
      // Antippen überspringt den kurzen Levelbanner.
      if (e.type === 'up') this.stateTimer = 0;
      return;
    }

    switch (e.type) {
      case 'down':
        // Browser lassen Audio erst nach einer Nutzergeste zu.
        this.audio.unlock();
        this.downOnShooter = Hud.isOnShooter(e.x, e.y);
        this.downOnMute = Hud.isOnMute(e.x, e.y);
        this.aimCancel = false;
        this.shooter.beginAim();
        break;

      case 'move':
        // Ziehen an beliebiger Stelle. dt bestimmt die Fingergeschwindigkeit
        // und damit, wie fein untersetzt wird.
        this.shooter.dragTo(e.dx, e.dt);
        this.aimCancel = e.y > CANCEL_ZONE_Y;
        break;

      case 'up': {
        this.shooter.endAim();
        const isTap = e.duration < TAP_MS && e.maxMove < TAP_PX;

        // Stummschalter — muss vor dem Tipp-Zielen geprüft werden, er liegt
        // in der oberen Bildschirmhälfte.
        if (isTap && this.downOnMute && Hud.isOnMute(e.x, e.y)) {
          this.shooter.abortAim();
          this.audio.toggleMuted();
          break;
        }

        // Tippen auf die Schleuder tauscht die Warteschlange.
        if (isTap && this.downOnShooter) {
          this.shooter.abortAim();
          this.shooter.swap();
          this.invalidateTrace();
          break;
        }
        // Kurzer Tipp in die obere Bildschirmhälfte: dorthin zielen und feuern.
        if (isTap && e.y < VH * 0.5) {
          this.shooter.aimAt(e.x, e.y);
          this.fire();
          break;
        }
        // Loslassen in den unteren 15 %: Schuss abbrechen.
        if (e.y > CANCEL_ZONE_Y) {
          this.shooter.abortAim();
          this.aimCancel = false;
          break;
        }
        this.fire();
        break;
      }

      case 'cancel':
        this.shooter.abortAim();
        this.aimCancel = false;
        break;
    }
  }

  /** Nächste Storytafel, oder los ins Spiel. */
  advanceStory() {
    if (this.storyT < 1) { this.storyT = 1; return; }   // erst zu Ende einblenden
    this.storyIndex++;
    this.storyT = 0;
    if (this.storyIndex >= STORY_PANELS.length) {
      markStorySeen();
      this.storyIndex = 0;
      this.state = 'ready';
      this.buildFromLevel();
    }
  }

  // --- Schuss ---------------------------------------------------------------

  fire() {
    this.aimCancel = false;
    if (this.state !== 'ready' || this.projectile) return false;

    const trace = this.computeTrace();
    if (!trace || !trace.cell) return false;   // kein gültiges Zielfeld

    const stone = this.shooter.take(this.grid);
    if (!stone) return false;

    this.projectile = { trace, dist: 0, stone, x: SHOOTER_X, y: SHOOTER_Y };
    this.state = 'flying';
    this.recoil = 1;
    this.invalidateTrace();
    this.audio.shoot();
    return true;
  }

  land() {
    const p = this.projectile;
    this.projectile = null;
    const [row, col] = p.trace.cell;
    this.grid.set(row, col, p.stone);
    this.gridVersion++;
    this.resolve(row, col);
  }

  /** Farbgruppe entfernen, Erreichbarkeit prüfen, Absturz auslösen, werten. */
  resolve(row, col) {
    const grid = this.grid;
    const mult = COMBO_MULT[Math.min(this.comboStreak, COMBO_MULT.length - 1)];
    let gained = 0;
    let popped = 0;
    let dropped = 0;

    const cluster = findCluster(grid, row, col);
    if (isMatch(cluster)) {
      // Von der Einschlagstelle nach außen, damit Bild und Tonleiter in
      // derselben Reihenfolge laufen wie der Blick des Spielers.
      const cx = grid.cellX(row, col), cy = grid.cellY(row);
      cluster.sort((a, b) => dist2(grid, a, cx, cy) - dist2(grid, b, cx, cy));

      cluster.forEach(([r, c], i) => {
        const s = grid.get(r, c);
        this.juice.pop(grid.cellX(r, c), grid.drawY(r), s.color);
        this.audio.pop(i);
        grid.remove(r, c);
      });
      popped = cluster.length;
      gained += popped * SCORE_POP;

      // Alles, was nicht mehr an der obersten Reihe hängt, stürzt ab.
      const loose = findFloating(grid);
      loose.forEach(([r, c], i) => {
        const s = grid.remove(r, c);
        if (!s) return;
        this.falling.spawn(grid.cellX(r, c), grid.drawY(r), s.color, s.kind, i);
        gained += SCORE_DROP_STEP * (i + 1);   // n-ter Stein: 20 * n
      });
      dropped = loose.length;

      this.juice.impact(popped + dropped);
      if (dropped > 0) {
        this.juice.drop(dropped);
        this.audio.drop(dropped);
      }
    } else {
      this.audio.stick();
    }

    const removed = popped + dropped;
    if (removed > 0) {
      this.score += Math.round(gained * mult);
      this.comboStreak++;
      this.missStreak = 0;
    } else {
      this.comboStreak = 0;
      this.missStreak++;
    }
    // Ab Kombo 3 kommt eine zusätzliche Instrumentenspur dazu.
    this.audio.setComboLayer(this.comboStreak >= COMBO_LAYER_AT);

    grid.normalize();
    this.gridVersion++;
    this.shooter.harmonize(grid);
    this.invalidateTrace();

    if (grid.isEmpty()) {
      this.state = 'won';
      this.stateTimer = 1.1;
      this.audio.win();
      return;
    }

    if (removed === 0 && this.missStreak >= MISS_LIMIT) {
      this.missStreak = 0;
      this.pushRow();
      return;
    }

    this.state = 'ready';
    this.checkFail();
  }

  /** Fehlschuss-Reihe: Nachschub ausschließlich in Farben, die noch liegen. */
  pushRow() {
    this.grid.pushRow(() => makeStone(this.shooter.pickColor(this.grid)));
    this.gridVersion++;
    this.shooter.harmonize(this.grid);
    this.invalidateTrace();
    this.state = 'pushing';
    this.stateTimer = ROW_PUSH_MS / 1000;
    this.juice.shake.add(7);          // Rumpeln
    this.audio.rumble();
  }

  checkFail() {
    if (this.grid.crossedFailLine()) {
      this.state = 'lost';
      this.stateTimer = RESTART_MS / 1000;
      this.juice.shake.add(12);
      this.audio.fail();
      return true;
    }
    return false;
  }

  // --- Simulation -----------------------------------------------------------

  update(dt) {
    this.time += dt;
    this.shooter.update(dt);
    this.falling.update(dt);
    this.juice.update(dt);
    this.hud.update(dt, this.score);
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 7);

    if (this.grid.pushAnim > 0) {
      this.grid.pushAnim = Math.max(0, this.grid.pushAnim - dt / (ROW_PUSH_MS / 1000));
    }

    if (this.state === 'story') {
      this.storyT = Math.min(1, this.storyT + dt / STORY_FADE);
      return;
    }

    switch (this.state) {
      case 'flying': {
        const p = this.projectile;
        p.dist += SHOT_SPEED * dt;
        if (p.dist >= p.trace.length) {
          this.land();
        } else {
          const pt = pointAtDistance(p.trace.points, p.dist);
          p.x = pt.x;
          p.y = pt.y;
        }
        break;
      }
      case 'pushing':
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.state = 'ready';
          this.grid.pushAnim = 0;
          this.checkFail();
        }
        break;
      case 'won':
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) this.nextLevel();
        break;
      case 'lost':
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) this.restartLevel();
        break;
    }
  }

  // --- Darstellung ----------------------------------------------------------

  render() {
    const r = this.r;
    const grid = this.grid;

    if (this.state === 'story') {
      r.begin();
      drawStoryPanel(r, this.storyIndex, this.storyT);
      if (this.storyT >= 1) {
        // Unter den Tafelzähler, den story.js selbst bei y = 1244 zeichnet.
        const puls = 0.55 + 0.45 * Math.sin(this.time * 3);
        r.text(this.storyIndex === STORY_PANELS.length - 1 ? 'TIPPEN ZUM SPIELEN' : 'TIPPEN',
          360, 1270, { size: 13, color: '#9a8cc4', align: 'center', weight: 700, alpha: puls });
      }
      r.end();
      return;
    }

    r.begin(this.juice.shake);
    r.drawBackground(this.biome);

    // Feld
    grid.forEach((s, row, col) => {
      r.drawStone(s.color, grid.cellX(row, col), grid.drawY(row));
    });

    r.drawFailLine(this.pulse());

    // Vorschau
    if (this.state === 'ready' && this.shooter.current) {
      r.drawPreview(this.computeTrace(), this.shooter.current.color, this.aimCancel);
    }

    // Fliegender Stein
    if (this.projectile) {
      r.drawStone(this.projectile.stone.color, this.projectile.x, this.projectile.y);
    }

    // Abstürzende Steine
    for (const f of this.falling.items) {
      r.drawStone(f.color, f.x, f.y, { rot: f.rot });
    }

    r.drawPops(this.juice);
    r.drawParticles(this.juice.particles);

    const glut = this.state === 'ready' ? 0.28 + 0.16 * Math.sin(this.time * 4) : 0;
    r.drawDragon(this.shooter.angle, glut, this.recoil);
    this.hud.draw(this);

    // Weißblitz beim Absturz, 15 % Deckkraft
    if (this.juice.flashAlpha > 0) r.overlay(`rgba(255,255,255,${this.juice.flashAlpha})`);

    if (this.state === 'won') {
      const a = Math.min(1, this.stateTimer * 3);
      this.hud.banner('Höhle geräumt!', `Punkte ${this.score}`, a);
    }
    if (this.state === 'lost') {
      const t = 1 - this.stateTimer / (RESTART_MS / 1000);
      r.overlay(`rgba(255,70,90,${0.42 * (1 - t)})`);
    }

    r.end();
  }

  /** Pulsieren der Fail-Linie, je näher die Steine kommen, desto kräftiger. */
  pulse() {
    const dist = FAIL_Y - this.grid.lowestEdge();
    const near = Math.max(0, 1 - dist / (ROW_HEIGHT * 3));
    return near * (0.5 + 0.5 * Math.sin(this.time * 6));
  }
}

/** Quadratischer Abstand eines Feldes zu einem Punkt — nur zum Sortieren. */
function dist2(grid, [r, c], x, y) {
  const dx = grid.cellX(r, c) - x;
  const dy = grid.cellY(r) - y;
  return dx * dx + dy * dy;
}

function storySeen() {
  try { return localStorage.getItem(STORY_KEY) === '1'; } catch { return false; }
}

function markStorySeen() {
  try { localStorage.setItem(STORY_KEY, '1'); } catch { /* egal */ }
}
