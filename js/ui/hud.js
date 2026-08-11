/**
 * HUD: Punkte, Kombo, Fehlschussanzeige, Warteschlange.
 * Alles unterhalb der Fail-Linie bzw. in der Deckenleiste — nie über dem Feld.
 */
import {
  VW, VH, MISS_LIMIT, CEILING_Y, SHOOTER_X, SHOOTER_Y, COMBO_MULT, CANCEL_ZONE_Y,
} from '../game/config.js';

const QUEUE_X = SHOOTER_X + 264;   // rechts neben dem Drachen
const QUEUE_Y = SHOOTER_Y - 24;
const MUTE_X = VW - 34;            // Lautsprecher in der Deckenleiste
const MUTE_Y = 28;
const MUTE_R = 30;

export class Hud {
  constructor(renderer) {
    this.r = renderer;
    this.shownScore = 0;
  }

  update(dt, score) {
    // Punkte laufen weich nach, damit ein großer Absturz sichtbar „zählt“.
    const diff = score - this.shownScore;
    if (Math.abs(diff) < 1) this.shownScore = score;
    else this.shownScore += diff * Math.min(1, dt * 9);
  }

  draw(game) {
    const r = this.r;

    // --- Deckenleiste: Level und Biom ---------------------------------------
    r.text(`${game.biome.name} · Level ${game.levelIndex + 1}`, 16, CEILING_Y - 22, {
      size: 20, color: '#c9b8ff', alpha: 0.9,
    });

    // --- Punkte -------------------------------------------------------------
    r.text(String(Math.round(this.shownScore)), 20, 1038, {
      size: 38, color: '#ffe9a8', weight: 800,
    });
    r.text('PUNKTE', 22, 1060, { size: 14, color: '#9a8cc4', weight: 600 });

    // --- Kombo --------------------------------------------------------------
    if (game.comboStreak > 0) {
      // Zeigt den Multiplikator, der auf den *nächsten* Treffer wirkt.
      const mult = COMBO_MULT[Math.min(game.comboStreak, COMBO_MULT.length - 1)];
      r.text(`x${mult}`, VW - 20, 1038, {
        size: 32, color: '#ffb3c2', align: 'right', weight: 800,
      });
      r.text('KOMBO', VW - 20, 1060, {
        size: 14, color: '#9a8cc4', align: 'right', weight: 600,
      });
    }

    // --- Fehlschuss-Anzeige: fünf Rauten, die sich füllen --------------------
    const dots = MISS_LIMIT;
    const w = 18, gap = 8;
    const totalW = dots * w + (dots - 1) * gap;
    const x0 = (VW - totalW) / 2;
    for (let i = 0; i < dots; i++) {
      const filled = i < game.missStreak;
      const cx = x0 + i * (w + gap) + w / 2;
      const cy = 1020;
      const ctx = r.ctx;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = filled ? '#ff6b7f' : 'rgba(255,255,255,0.14)';
      ctx.strokeStyle = filled ? '#ffd0d8' : 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(-w / 2 * 0.72, -w / 2 * 0.72, w * 0.72, w * 0.72);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    r.text('NACHSCHUB', VW / 2, 1060, {
      size: 13, color: '#9a8cc4', align: 'center', weight: 600,
    });

    // --- Warteschlange: aktueller + nächster Stein ---------------------------
    const s = game.shooter;
    if (s.next) {
      r.drawStone(s.next.color, QUEUE_X, QUEUE_Y, { alpha: 0.92, scale: 0.66 });
      r.text('NÄCHSTER', QUEUE_X, QUEUE_Y + 42, {
        size: 12, color: '#9a8cc4', align: 'center', weight: 600,
      });
    }
    // Der geladene Stein liegt exakt auf dem Abschusspunkt im Maul des Drachen.
    if (s.current && !game.projectile) {
      r.drawStone(s.current.color, SHOOTER_X, SHOOTER_Y, { scale: 1 });
    }

    this.drawMute(game.audio.muted);

    // Abbruchzone sichtbar machen, solange der Finger darin liegt. Ohne diese
    // Rückmeldung wirkt ein abgebrochener Schuss wie eine verschluckte Eingabe.
    if (game.aimCancel) {
      const ctx = r.ctx;
      ctx.save();
      const wash = ctx.createLinearGradient(0, CANCEL_ZONE_Y, 0, VH);
      wash.addColorStop(0, 'rgba(255,70,90,0)');
      wash.addColorStop(1, 'rgba(255,70,90,0.32)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, CANCEL_ZONE_Y, VW, VH - CANCEL_ZONE_Y);
      ctx.strokeStyle = 'rgba(255,150,160,0.75)';
      ctx.lineWidth = 2;
      ctx.setLineDash([12, 10]);
      ctx.beginPath();
      ctx.moveTo(0, CANCEL_ZONE_Y);
      ctx.lineTo(VW, CANCEL_ZONE_Y);
      ctx.stroke();
      ctx.restore();
      r.text('LOSLASSEN BRICHT AB', VW / 2, CANCEL_ZONE_Y + 36, {
        size: 20, color: '#ffd6dc', align: 'center', weight: 700,
      });
    }

    // Tausch-Hinweis
    if (s.swapFlash > 0) {
      const ctx = r.ctx;
      ctx.save();
      ctx.globalAlpha = s.swapFlash * 0.7;
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(SHOOTER_X, SHOOTER_Y, 52 + (1 - s.swapFlash) * 28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Lautsprecher-Schalter: prozedural gezeichnet, kein Zeichensatz-Glyph. */
  drawMute(muted) {
    const ctx = this.r.ctx;
    ctx.save();
    ctx.translate(MUTE_X, MUTE_Y);
    ctx.globalAlpha = muted ? 0.45 : 0.85;
    ctx.fillStyle = '#c9b8ff';
    ctx.strokeStyle = '#c9b8ff';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';

    // Membran
    ctx.beginPath();
    ctx.moveTo(-9, -4);
    ctx.lineTo(-4, -4);
    ctx.lineTo(2, -10);
    ctx.lineTo(2, 10);
    ctx.lineTo(-4, 4);
    ctx.lineTo(-9, 4);
    ctx.closePath();
    ctx.fill();

    if (muted) {
      ctx.beginPath();
      ctx.moveTo(7, -6);
      ctx.lineTo(15, 6);
      ctx.moveTo(15, -6);
      ctx.lineTo(7, 6);
      ctx.stroke();
    } else {
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(2, 0, 4 + i * 4.5, -0.9, 0.9);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Trefferfläche des Lautsprechers. */
  static isOnMute(x, y) {
    return Math.hypot(x - MUTE_X, y - MUTE_Y) < MUTE_R;
  }

  /** Trefferfläche der Schleuder (Tippen tauscht die Warteschlange). */
  static isOnShooter(x, y) {
    return Math.hypot(x - SHOOTER_X, y - SHOOTER_Y) < 92
        || Math.hypot(x - QUEUE_X, y - QUEUE_Y) < 52;
  }

  /** Kurzer Banner-Text, z. B. „Level geschafft“. */
  banner(text, sub, alpha = 1) {
    const r = this.r;
    r.roundRect(VW / 2 - 200, 560, 400, 118, 22, `rgba(12,7,26,${0.82 * alpha})`,
      `rgba(180,150,255,${0.5 * alpha})`, 2);
    r.text(text, VW / 2, 612, {
      size: 38, color: '#ffe9a8', align: 'center', weight: 800, alpha,
    });
    if (sub) {
      r.text(sub, VW / 2, 648, {
        size: 20, color: '#c9b8ff', align: 'center', weight: 600, alpha,
      });
    }
  }
}
