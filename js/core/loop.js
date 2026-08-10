/**
 * Fester Physik-Zeitschritt, Rendering per requestAnimationFrame.
 * Der Akkumulator entkoppelt die Simulation von der Bildwiederholrate,
 * damit sich das Spiel auf 60-, 90- und 120-Hz-Geräten identisch anfühlt.
 */
export class Loop {
  /**
   * @param {object} opts
   * @param {number} opts.step   Physikschritt in Sekunden (Standard 1/60)
   * @param {number} opts.maxSteps Obergrenze der Nachholschritte je Frame
   * @param {(dt:number)=>void} opts.update
   * @param {(alpha:number)=>void} opts.render
   */
  constructor({ step = 1 / 60, maxSteps = 5, update, render }) {
    this.step = step;
    this.maxSteps = maxSteps;
    this.update = update;
    this.render = render;

    this.running = false;
    this.acc = 0;
    this.last = 0;
    this.timeScale = 1;       // wird ab Meilenstein 3 fürs Hitstop genutzt
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
  }

  _frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this._frame);

    // Große Sprünge (Tab im Hintergrund) abschneiden statt nachzuholen.
    let frameTime = (now - this.last) / 1000;
    this.last = now;
    if (frameTime > 0.25) frameTime = 0.25;

    this._fpsAcc += frameTime;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }

    this.acc += frameTime * this.timeScale;

    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSteps) {
      this.update(this.step);
      this.acc -= this.step;
      steps++;
    }
    // Rückstand verwerfen, damit wir nach einem Hänger nicht dauerhaft hinterherlaufen.
    if (steps === this.maxSteps) this.acc = 0;

    this.render(this.acc / this.step);
  }
}
