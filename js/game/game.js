/**
 * Spielablauf: Zustand, Regeln, Eingabe-Semantik.
 *
 * Meilenstein 1 + Steuerung/Vorschau aus Meilenstein 2.
 * Effekte (Partikel, Screenshake, Hitstop) und Audio folgen in Meilenstein 3;
 * die Einhängepunkte dafür sind unten mit TODO markiert.
 */
import {
  VH, SHOOTER_X, SHOOTER_Y, SHOT_SPEED, CANCEL_ZONE_Y, TAP_MS, TAP_PX,
  MISS_LIMIT, ROW_PUSH_MS, SCORE_POP, SCORE_DROP_STEP, COMBO_MULT, RESTART_MS,
  ROW_HEIGHT, FAIL_Y,
} from './config.js';
import { makeStone } from './grid.js';
import { Shooter } from './shooter.js';
import { traceShot, pointAtDistance, FallingStones } from './physics.js';
import { findCluster, isMatch, findFloating } from './match.js';
import { buildGrid, levelAt, biomeOf, mulberry32, hashString } from './levels.js';
import { Hud } from '../ui/hud.js';

/** @typedef {'ready'|'flying'|'pushing'|'won'|'lost'} State */

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
    this.falling = new FallingStones(() => this.rng());

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

    this.loadLevel(0);
  }

  // --- Level ----------------------------------------------------------------

  loadLevel(index) {
    this.levelIndex = index;
    this.level = levelAt(this.data, index);
    this.biome = biomeOf(this.level);
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
    if (this.state === 'lost') return;
    if (this.state === 'won') {
      // Antippen überspringt den kurzen Levelbanner.
      if (e.type === 'up') this.stateTimer = 0;
      return;
    }

    switch (e.type) {
      case 'down':
        this.downOnShooter = Hud.isOnShooter(e.x, e.y);
        this.aimCancel = false;
        this.shooter.beginAim();
        break;

      case 'move':
        // Ziehen an beliebiger Stelle: Winkel = eingefroren + dx * 0,18°/px.
        this.shooter.dragTo(e.dx);
        this.aimCancel = e.y > CANCEL_ZONE_Y;
        break;

      case 'up': {
        this.shooter.endAim();
        const isTap = e.duration < TAP_MS && e.maxMove < TAP_PX;

        // Tippen auf die Schleuder tauscht die Warteschlange.
        if (isTap && this.downOnShooter) {
          this.shooter.angle = this.shooter.frozenAngle;
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
          this.shooter.angle = this.shooter.frozenAngle;
          this.aimCancel = false;
          break;
        }
        this.fire();
        break;
      }

      case 'cancel':
        this.shooter.endAim();
        this.shooter.angle = this.shooter.frozenAngle;
        this.aimCancel = false;
        break;
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
    this.invalidateTrace();
    // TODO(M3): Schussgeräusch + Rückstoß der Schleuder.
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
      for (const [r, c] of cluster) {
        grid.remove(r, c);
        // TODO(M3): Platz-Partikel + Squash-Stretch + Tonleiterstufe.
      }
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
      // TODO(M3): Hitstop ab 6 Steinen, Weißblitz, Funkenregen, Glissando.
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

    grid.normalize();
    this.gridVersion++;
    this.shooter.harmonize(grid);
    this.invalidateTrace();

    if (grid.isEmpty()) {
      this.state = 'won';
      this.stateTimer = 1.1;
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
    // TODO(M3): Rumpeln (Shake + tiefer Impuls).
  }

  checkFail() {
    if (this.grid.crossedFailLine()) {
      this.state = 'lost';
      this.stateTimer = RESTART_MS / 1000;
      return true;
    }
    return false;
  }

  // --- Simulation -----------------------------------------------------------

  update(dt) {
    this.time += dt;
    this.shooter.update(dt);
    this.falling.update(dt);
    this.hud.update(dt, this.score);

    if (this.grid.pushAnim > 0) {
      this.grid.pushAnim = Math.max(0, this.grid.pushAnim - dt / (ROW_PUSH_MS / 1000));
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

    r.begin();
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

    const glut = this.state === 'ready' ? 0.28 + 0.16 * Math.sin(this.time * 4) : 0;
    r.drawDragon(this.shooter.angle, glut);
    this.hud.draw(this);

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
