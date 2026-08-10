/**
 * Zeigereingabe: Touch zuerst, Maus als Fallback.
 * Diese Schicht rechnet Bildschirmkoordinaten in virtuelle Einheiten um und
 * meldet rohe Ereignisse. Die Spielsemantik (Zielen, Feuern, Abbrechen)
 * liegt bewusst im Spielcode, nicht hier.
 */
export class Input {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{toVirtual:(clientX:number,clientY:number)=>{x:number,y:number}}} view
   */
  constructor(canvas, view) {
    this.canvas = canvas;
    this.view = view;
    this.active = false;
    this.pointerId = null;

    this.startX = 0; this.startY = 0; this.startTime = 0;
    this.x = 0; this.y = 0;
    this.dx = 0; this.dy = 0;
    this.maxMove = 0;

    /** @type {(e:{type:string,x:number,y:number,dx:number,dy:number,duration:number,maxMove:number})=>void} */
    this.onEvent = () => {};

    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    this._cancel = this._cancel.bind(this);

    canvas.addEventListener('pointerdown', this._down, { passive: false });
    window.addEventListener('pointermove', this._move, { passive: false });
    window.addEventListener('pointerup', this._up, { passive: false });
    window.addEventListener('pointercancel', this._cancel, { passive: false });
    // Kontextmenü bei langem Druck unterbinden.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _emit(type) {
    this.onEvent({
      type,
      x: this.x,
      y: this.y,
      dx: this.dx,
      dy: this.dy,
      duration: performance.now() - this.startTime,
      maxMove: this.maxMove,
    });
  }

  _down(e) {
    if (this.active) return;
    e.preventDefault();
    const p = this.view.toVirtual(e.clientX, e.clientY);
    this.active = true;
    this.pointerId = e.pointerId;
    this.startX = this.x = p.x;
    this.startY = this.y = p.y;
    this.dx = this.dy = 0;
    this.maxMove = 0;
    this.startTime = performance.now();
    if (this.canvas.setPointerCapture) {
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* egal */ }
    }
    this._emit('down');
  }

  _move(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const p = this.view.toVirtual(e.clientX, e.clientY);
    this.x = p.x;
    this.y = p.y;
    this.dx = this.x - this.startX;
    this.dy = this.y - this.startY;
    this.maxMove = Math.max(this.maxMove, Math.hypot(this.dx, this.dy));
    this._emit('move');
  }

  _up(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const p = this.view.toVirtual(e.clientX, e.clientY);
    this.x = p.x;
    this.y = p.y;
    this.dx = this.x - this.startX;
    this.dy = this.y - this.startY;
    this.maxMove = Math.max(this.maxMove, Math.hypot(this.dx, this.dy));
    this._emit('up');
    this.active = false;
    this.pointerId = null;
  }

  _cancel(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    this._emit('cancel');
    this.active = false;
    this.pointerId = null;
  }
}
