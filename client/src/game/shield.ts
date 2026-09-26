/**
 * shield.ts — Escudo Estelar (inspirado no escudo do Capitão América):
 * disco metálico côncavo, anéis vermelho/branco, centro azul, estrela branca.
 * Nas costas quando equipado, erguido na frente quando ativo, girando quando
 * arremessado. Tudo vetorial; 1 gradiente por escudo visível.
 */

export const SHIELD_COLORS = {
  red: "#c21f2c",
  redDark: "#8e1520",
  white: "#eef0f4",
  whiteShade: "#b9bec8",
  blue: "#1d3d97",
  blueDark: "#142a6a",
  back: "#9aa1ab",
  strap: "#5a3a22",
};

export interface ShieldDrawOpts {
  /** 1 = visto de frente, ~0.3 = de lado (perspectiva) */
  squash?: number;
  /** rotação do eixo do elipse */
  rot?: number;
  /** giro da face (arremesso) */
  spin?: number;
  /** energia do bloqueio 0..1 */
  glow?: number;
  /** mostra o verso (alças) em vez da face */
  back?: boolean;
  /** ms (pulso do brilho) */
  t?: number;
}

function star(ctx: CanvasRenderingContext2D, r: number, inner: number, rot: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : inner;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function disc(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
}

export function drawStarShield(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  o: ShieldDrawOpts = {},
) {
  const squash = Math.max(0.12, Math.min(1, o.squash ?? 1));
  const glow = o.glow ?? 0;
  const t = o.t ?? 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.rot ?? 0);

  if (glow > 0.01) {
    const pulse = 0.75 + 0.25 * Math.sin(t * 0.018);
    ctx.save();
    ctx.scale(squash, 1);
    ctx.globalAlpha *= glow * pulse;
    ctx.fillStyle = "rgba(140,200,255,0.22)";
    disc(ctx, r + 9);
    ctx.fill();
    ctx.strokeStyle = "rgba(190,230,255,0.9)";
    ctx.lineWidth = 2.5;
    disc(ctx, r + 4);
    ctx.stroke();
    ctx.restore();
  }

  // espessura (borda lateral quando visto de lado)
  if (squash < 0.95) {
    ctx.save();
    ctx.scale(squash, 1);
    ctx.fillStyle = SHIELD_COLORS.redDark;
    ctx.beginPath();
    ctx.arc(-2.2 / squash, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.scale(squash, 1);
  if (o.back) {
    // verso: metal escovado + alças de couro
    disc(ctx, r);
    ctx.fillStyle = SHIELD_COLORS.back;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    for (const k of [0.8, 0.6, 0.4]) {
      disc(ctx, r * k);
      ctx.stroke();
    }
    ctx.fillStyle = SHIELD_COLORS.strap;
    ctx.fillRect(-r * 0.62, -r * 0.16, r * 1.24, r * 0.18);
    ctx.fillRect(-r * 0.12, -r * 0.62, r * 0.18, r * 1.24);
    ctx.fillStyle = "#8a8f96";
    for (const [bx, by] of [
      [-r * 0.58, -r * 0.07],
      [r * 0.52, -r * 0.07],
      [-r * 0.03, -r * 0.58],
      [-r * 0.03, r * 0.52],
    ]) {
      ctx.beginPath();
      ctx.arc(bx!, by!, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // face: anéis concêntricos
    disc(ctx, r);
    ctx.fillStyle = SHIELD_COLORS.red;
    ctx.fill();
    disc(ctx, r * 0.79);
    ctx.fillStyle = SHIELD_COLORS.white;
    ctx.fill();
    disc(ctx, r * 0.58);
    ctx.fillStyle = SHIELD_COLORS.red;
    ctx.fill();
    disc(ctx, r * 0.39);
    ctx.fillStyle = SHIELD_COLORS.blue;
    ctx.fill();
    star(ctx, r * 0.34, r * 0.14, o.spin ?? 0);
    ctx.fillStyle = SHIELD_COLORS.white;
    ctx.fill();
    // bisel entre anéis (metal côncavo)
    ctx.lineWidth = 1;
    for (const k of [0.79, 0.58, 0.39]) {
      ctx.strokeStyle = "rgba(0,0,0,0.32)";
      ctx.beginPath();
      ctx.arc(0, 0, r * k, Math.PI * 0.15, Math.PI * 1.15);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(0, 0, r * k - 1, Math.PI * 1.15, Math.PI * 2.15);
      ctx.stroke();
    }
  }
  // brilho metálico (luz de cima-esquerda) + sombra embaixo-direita
  const sh = ctx.createRadialGradient(-r * 0.38, -r * 0.42, r * 0.05, -r * 0.1, -r * 0.1, r * 1.1);
  sh.addColorStop(0, "rgba(255,255,255,0.55)");
  sh.addColorStop(0.35, "rgba(255,255,255,0.12)");
  sh.addColorStop(0.7, "rgba(0,0,0,0)");
  sh.addColorStop(1, "rgba(0,0,20,0.28)");
  disc(ctx, r);
  ctx.fillStyle = sh;
  ctx.fill();
  // aro e contorno
  ctx.strokeStyle = "#1a1411";
  ctx.lineWidth = 2;
  disc(ctx, r);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, r - 2, Math.PI * 1.08, Math.PI * 1.42);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

/** Faísca de ricochete no escudo (partículas simples — client-side). */
export interface ShieldSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

const sparks: ShieldSpark[] = [];

export function spawnShieldSparks(x: number, y: number, n = 10) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 120 + Math.random() * 260;
    sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 180 + Math.random() * 160 });
  }
  while (sparks.length > 160) sparks.shift();
}

export function tickShieldSparks(dtMs: number) {
  const dt = dtMs / 1000;
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]!;
    s.life -= dtMs;
    if (s.life <= 0) {
      sparks.splice(i, 1);
      continue;
    }
    s.vy += 520 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
}

export function drawShieldSparks(ctx: CanvasRenderingContext2D) {
  if (!sparks.length) return;
  ctx.save();
  ctx.lineCap = "round";
  for (const s of sparks) {
    const a = Math.min(1, s.life / 160);
    ctx.strokeStyle = `rgba(255,${200 + ((s.life * 3) % 55)},140,${a})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x - s.vx * 0.018, s.y - s.vy * 0.018);
    ctx.stroke();
  }
  ctx.restore();
}
