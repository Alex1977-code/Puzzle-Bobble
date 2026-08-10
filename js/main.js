/**
 * DRACHENFUNKE — Einstiegspunkt.
 *
 * Bindet Renderer, Eingabe, Spiel und die Schleife zusammen.
 * Kein Build-Step, keine externen Bibliotheken: einfach über einen
 * beliebigen statischen Server ausliefern (ES-Module brauchen http://).
 */
import { Renderer } from './core/render.js';
import { Input } from './core/input.js';
import { Loop } from './core/loop.js';
import { Game } from './game/game.js';
import { loadLevels } from './game/levels.js';

async function boot() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
  const renderer = new Renderer(canvas);

  const levels = await loadLevels();
  const game = new Game(renderer, levels);

  const input = new Input(canvas, renderer);
  input.onEvent = (e) => game.onPointer(e);

  const loop = new Loop({
    step: 1 / 60,
    update: (dt) => game.update(dt),
    render: () => game.render(),
  });

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderer.resize();
      game.render();
    }, 60);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // Bei verstecktem Tab anhalten — spart Akku und verhindert Zeitsprünge.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.stop();
    else loop.start();
  });

  loop.start();

  // Für schnelles Prüfen in der Konsole und für automatisierte Rauchtests.
  window.DRACHENFUNKE = { game, renderer, loop, input };
}

boot().catch((err) => {
  console.error('[Drachenfunke] Start fehlgeschlagen:', err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<p class="fallback">Start fehlgeschlagen: ${String(err && err.message || err)}</p>`,
  );
});
