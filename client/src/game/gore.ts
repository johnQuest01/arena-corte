/**
 * gore.ts — sangue, gibs, cadáveres, decals + números de dano/kill (client-only).
 */
import { LOADOUTS, weaponOf } from "../../../shared/gear";
import type { TickEvent } from "../../../shared/protocol";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: string;
  kind: "blood" | "dust" | "flame" | "shell";
}

export interface Gib {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  life: number;
  angle: number;
  spin: number;
}

export interface Corpse {
  x: number;
  y: number;
  angle: number;
  id: number;
  t: number;
}

interface FloatNum {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  text: string;
  color: string;
  size: number;
  /** outline escuro pra ler no sangue */
  stroke: string;
}

const MAX_PARTS = 400;
const particles: Particle[] = [];
const gibs: Gib[] = [];
const corpses: Corpse[] = [];
const floats: FloatNum[] = [];
const flashHit = new Map<number, number>(); // playerId → untilMs

/**
 * Decals em chunks ESPARSOS (256 px) criados só onde há marca — antes era um
 * canvas do mapa inteiro (5120×3840 ≈ 78 MB, acima do limite do iOS).
 */
const DECAL_CH = 256;
const MAX_DECAL_CHUNKS = 48;
interface DecalChunk {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  cx: number;
  cy: number;
  count: number;
  touched: number;
}
const decalChunks = new Map<number, DecalChunk>();
let decalStamp = 0;
let decalW = 0;
let decalH = 0;
const MAX_DECALS_PER_CHUNK = 90;

export function initDecals(w: number, h: number) {
  decalW = w;
  decalH = h;
}

function decalChunkAt(cx: number, cy: number): DecalChunk | null {
  if (cx < 0 || cy < 0 || cx * DECAL_CH >= decalW || cy * DECAL_CH >= decalH) return null;
  const key = cy * 1024 + cx;
  let c = decalChunks.get(key);
  if (!c) {
    if (decalChunks.size >= MAX_DECAL_CHUNKS) {
      // recicla o chunk menos recente
      let oldKey = -1;
      let oldT = Infinity;
      for (const [k, v] of decalChunks) {
        if (v.touched < oldT) {
          oldT = v.touched;
          oldKey = k;
        }
      }
      const old = decalChunks.get(oldKey)!;
      decalChunks.delete(oldKey);
      old.g.setTransform(1, 0, 0, 1, 0, 0);
      old.g.clearRect(0, 0, DECAL_CH, DECAL_CH);
      c = { ...old, cx, cy, count: 0, touched: 0 };
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = DECAL_CH;
      canvas.height = DECAL_CH;
      c = { canvas, g: canvas.getContext("2d")!, cx, cy, count: 0, touched: 0 };
    }
    decalChunks.set(key, c);
  }
  c.touched = ++decalStamp;
  return c;
}

export function clearDecals() {
  for (const c of decalChunks.values()) {
    c.g.setTransform(1, 0, 0, 1, 0, 0);
    c.g.clearRect(0, 0, DECAL_CH, DECAL_CH);
    c.count = 0;
  }
  decalChunks.clear();
  particles.length = 0;
  gibs.length = 0;
  corpses.length = 0;
  floats.length = 0;
  flashHit.clear();
}

function pushPart(p: Particle) {
  particles.push(p);
  while (particles.length > MAX_PARTS) particles.shift();
}

function pushFloat(f: FloatNum) {
  floats.push(f);
  while (floats.length > 40) floats.shift();
}

function damageFromHit(weaponId: number | undefined): number {
  const id = weaponId ?? 0;
  if (id === 100) return 55;
  if (id === 101) return 12;
  if (id === 105) return 34;
  if (id === 106) return 26;
  if (id >= 0 && id <= 6) return weaponOf(id).damage;
  return 20;
}

function spawnDamageFloat(
  x: number,
  y: number,
  amount: number,
  kind: "out" | "in",
) {
  const crit = amount >= 50;
  pushFloat({
    x: x + (Math.random() - 0.5) * 18,
    y: y - 20,
    vx: (Math.random() - 0.5) * 28,
    vy: -45 - Math.random() * 35,
    life: crit ? 900 : 750,
    max: crit ? 900 : 750,
    text: `-${amount}`,
    color: kind === "out" ? (crit ? "#ffe566" : "#fff2c8") : "#ff4a4a",
    size: kind === "out" ? (crit ? 22 : 16) : 18,
    stroke: kind === "out" ? "#3a1800" : "#4a0000",
  });
}

function spawnKillFloat(x: number, y: number) {
  pushFloat({
    x,
    y: y - 36,
    vx: 0,
    vy: -55,
    life: 1400,
    max: 1400,
    text: "+1 KILL",
    color: "#ffd24a",
    size: 20,
    stroke: "#2a1800",
  });
}

function stampDecal(x: number, y: number, r: number, color: string, a = 0.55) {
  // pode tocar até 4 chunks se estiver na borda
  const rot = Math.random() * Math.PI;
  const cx0 = Math.floor((x - r) / DECAL_CH);
  const cx1 = Math.floor((x + r) / DECAL_CH);
  const cy0 = Math.floor((y - r) / DECAL_CH);
  const cy1 = Math.floor((y + r) / DECAL_CH);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = decalChunkAt(cx, cy);
      if (!c) continue;
      const g = c.g;
      g.setTransform(1, 0, 0, 1, -cx * DECAL_CH, -cy * DECAL_CH);
      if (c.count >= MAX_DECALS_PER_CHUNK) {
        // desbota uma região aleatória (mantém o chunk "vivo" sem crescer)
        g.globalCompositeOperation = "destination-out";
        g.fillStyle = "rgba(0,0,0,0.1)";
        g.fillRect(cx * DECAL_CH + Math.random() * DECAL_CH, cy * DECAL_CH + Math.random() * DECAL_CH, 48, 48);
        g.globalCompositeOperation = "source-over";
      }
      g.fillStyle = color;
      g.globalAlpha = a;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.65, rot, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      c.count++;
    }
  }
}

export function stampBulletMark(x: number, y: number) {
  stampDecal(x, y, 2, "#1a1410", 0.75);
}

export function stampShell(x: number, y: number) {
  stampDecal(x, y, 1.2, "#c8a060", 0.7);
}

/** Cores do corpo caído — vêm do visual (cosméticos) de cada jogador. */
export interface CorpseColors {
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
  shoes: string;
  /** capacete/elmo cobre a cabeça */
  helmet?: string;
}

let colorProvider: ((id: number) => CorpseColors) | null = null;

export function setCorpseColorProvider(fn: (id: number) => CorpseColors) {
  colorProvider = fn;
}

/** roundRect compatível (Safari < 16 não tem ctx.roundRect). */
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function lookOf(id: number): CorpseColors {
  if (colorProvider) return colorProvider(id);
  const l = LOADOUTS[id % LOADOUTS.length]!;
  return { shirt: l.shirt, pants: l.pants, skin: l.skin, hair: l.hair, shoes: l.shoes };
}

export function processGoreEvents(events: TickEvent[], now: number, selfId = -1) {
  for (const e of events) {
    // 255 = parede; 253 = bloqueio/ricochete de escudo — sem sangue
    if (e.kind === "hit" && e.b !== 255 && e.b !== 253) {
      const ang = Math.random() * Math.PI * 2;
      const n = 4 + Math.floor(Math.random() * 5);
      for (let i = 0; i < n; i++) {
        const a = ang + (Math.random() - 0.5);
        const sp = 40 + Math.random() * 120;
        pushPart({
          x: e.x,
          y: e.y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 280 + Math.random() * 200,
          max: 400,
          r: 1.5 + Math.random() * 2,
          color: "#8a1515",
          kind: "blood",
        });
      }
      flashHit.set(e.b, now + 50);

      // números de dano: você acertou / te acertaram
      const dmg = damageFromHit(e.weaponId);
      if (e.a === selfId && e.b !== selfId) {
        spawnDamageFloat(e.x, e.y, dmg, "out");
      } else if (e.b === selfId) {
        spawnDamageFloat(e.x, e.y, dmg, "in");
      }
    }
    if (e.kind === "death") {
      if (e.a === selfId && e.b !== selfId) {
        spawnKillFloat(e.x, e.y);
      }
      const cause = e.weaponId ?? 0;
      const look = lookOf(e.b);
      // Fenda: o boneco cai no buraco (abilities_fx) — sem cadáver no chão
      if (cause === 102) {
        continue;
      }
      if (cause === 100 || cause === 103) {
        // explosão / bomba — despedaça (bomba: mais gibs)
        const n = cause === 103 ? 14 : 8;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
          const sp = (cause === 103 ? 120 : 80) + Math.random() * (cause === 103 ? 240 : 180);
          const colors = [look.shirt, look.pants, look.skin, look.hair];
          gibs.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            w: 4 + Math.random() * 6,
            h: 3 + Math.random() * 5,
            color: colors[i % colors.length]!,
            life: 2500,
            angle: a,
            spin: (Math.random() - 0.5) * 8,
          });
        }
      } else if (cause === 101) {
        // fogo
        for (let i = 0; i < 12; i++) {
          pushPart({
            x: e.x,
            y: e.y,
            vx: (Math.random() - 0.5) * 40,
            vy: -30 - Math.random() * 60,
            life: 1000,
            max: 1000,
            r: 3,
            color: "#e86020",
            kind: "flame",
          });
        }
        corpses.push({ x: e.x, y: e.y, angle: Math.random() * Math.PI, id: e.b, t: 0 });
      } else if (cause === 6) {
        // sniper gibs
        corpses.push({ x: e.x, y: e.y, angle: Math.PI / 2, id: e.b, t: 0 });
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          gibs.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * 160,
            vy: Math.sin(a) * 160,
            w: 6,
            h: 4,
            color: i ? look.shirt : look.skin,
            life: 2000,
            angle: a,
            spin: 4,
          });
        }
        for (let i = 0; i < 10; i++) {
          pushPart({
            x: e.x,
            y: e.y,
            vx: Math.cos(i) * 100,
            vy: Math.sin(i) * 40,
            life: 500,
            max: 500,
            r: 2,
            color: "#6a1010",
            kind: "blood",
          });
        }
      } else {
        corpses.push({ x: e.x, y: e.y, angle: Math.PI / 2, id: e.b, t: 0 });
        const rifle = cause >= 1 && cause <= 3;
        const n = rifle ? 12 : 6;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          pushPart({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * (60 + Math.random() * 100),
            vy: Math.sin(a) * (60 + Math.random() * 100),
            life: 600,
            max: 600,
            r: 2,
            color: "#7a1212",
            kind: "blood",
          });
        }
      }
      // poça que cresce
      for (let i = 0; i < 8; i++) {
        stampDecal(e.x + (Math.random() - 0.5) * 10, e.y + (Math.random() - 0.5) * 8, 4 + i, "#5a0e0e", 0.35);
      }
    }
  }
}

export function tickGore(dtMs: number, now: number) {
  for (const p of particles) {
    p.x += p.vx * (dtMs / 1000);
    p.y += p.vy * (dtMs / 1000);
    p.vx *= 0.96;
    p.vy *= 0.96;
    if (p.kind === "blood") p.vy += 40 * (dtMs / 1000);
    p.life -= dtMs;
    if (p.life <= 0 && p.kind === "blood") {
      stampDecal(p.x, p.y, p.r, "#5a1010", 0.5);
    }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i]!.life <= 0) particles.splice(i, 1);
  }

  for (const g of gibs) {
    g.x += g.vx * (dtMs / 1000);
    g.y += g.vy * (dtMs / 1000);
    g.vx *= 0.94;
    g.vy = g.vy * 0.94 + 90 * (dtMs / 1000);
    g.angle += g.spin * (dtMs / 1000);
    g.life -= dtMs;
    if (Math.hypot(g.vx, g.vy) < 12) {
      stampDecal(g.x, g.y, 3, g.color, 0.6);
      g.vx = 0;
      g.vy = 0;
    } else {
      stampDecal(g.x, g.y, 1.2, "#6a1010", 0.25);
    }
  }
  for (let i = gibs.length - 1; i >= 0; i--) {
    if (gibs[i]!.life <= 0) gibs.splice(i, 1);
  }

  for (const c of corpses) {
    c.t += dtMs;
    if (c.t < 2000 && c.t % 80 < dtMs) {
      stampDecal(c.x, c.y, 6 + c.t / 200, "#4a0c0c", 0.2);
    }
  }

  for (const [id, until] of flashHit) {
    if (now > until) flashHit.delete(id);
  }

  for (const f of floats) {
    f.x += f.vx * (dtMs / 1000);
    f.y += f.vy * (dtMs / 1000);
    f.vy += 55 * (dtMs / 1000); // sobe e desacelera
    f.vx *= 0.98;
    f.life -= dtMs;
  }
  for (let i = floats.length - 1; i >= 0; i--) {
    if (floats[i]!.life <= 0) floats.splice(i, 1);
  }
}

export function hitFlashActive(id: number, now: number) {
  return (flashHit.get(id) ?? 0) > now;
}

export function drawDecalLayer(
  ctx: CanvasRenderingContext2D,
  camX = 0,
  camY = 0,
  viewW = 0,
  viewH = 0,
) {
  if (decalChunks.size === 0) return;
  const x1 = viewW > 0 ? camX + viewW : decalW;
  const y1 = viewH > 0 ? camY + viewH : decalH;
  for (const c of decalChunks.values()) {
    const x = c.cx * DECAL_CH;
    const y = c.cy * DECAL_CH;
    if (x + DECAL_CH < camX || y + DECAL_CH < camY || x > x1 || y > y1) continue;
    ctx.drawImage(c.canvas, x, y);
  }
}

export function drawGoreActors(ctx: CanvasRenderingContext2D) {
  for (const c of corpses) {
    const look = lookOf(c.id);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.globalAlpha = 0.92;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1411";
    ctx.lineWidth = 2;
    // sombra
    ctx.fillStyle = "rgba(12,8,10,0.3)";
    ctx.beginPath();
    ctx.ellipse(4, 3, 34, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    // pernas + sapatos
    ctx.fillStyle = look.pants;
    for (const ly of [-5, 5]) {
      rrect(ctx, 8, ly - 4, 20, 8, 3);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = look.shoes;
    for (const ly of [-5, 5]) {
      rrect(ctx, 26, ly - 4.5, 8, 9, 3);
      ctx.fill();
      ctx.stroke();
    }
    // tronco
    ctx.fillStyle = look.shirt;
    rrect(ctx, -12, -12, 24, 24, 6);
    ctx.fill();
    ctx.stroke();
    // cabeça
    ctx.fillStyle = look.helmet ?? look.skin;
    ctx.beginPath();
    ctx.arc(-22, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (!look.helmet) {
      ctx.fillStyle = look.hair;
      ctx.beginPath();
      ctx.arc(-24, 0, 10, Math.PI * 0.55, Math.PI * 1.45);
      ctx.fill();
      // olhos "X"
      ctx.strokeStyle = "#1a1411";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (const ey of [-4, 4]) {
        ctx.moveTo(-18, ey - 2);
        ctx.lineTo(-15, ey + 2);
        ctx.moveTo(-15, ey - 2);
        ctx.lineTo(-18, ey + 2);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const g of gibs) {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle);
    ctx.fillStyle = g.color;
    ctx.fillRect(-g.w / 2, -g.h / 2, g.w, g.h);
    ctx.restore();
  }
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // números de dano / kill por cima do sangue
  for (const f of floats) {
    const u = f.life / f.max;
    const a = Math.min(1, u * 1.4);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `bold ${f.size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = f.stroke;
    ctx.fillStyle = f.color;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }
}

export function spawnDust(x: number, y: number) {
  for (let i = 0; i < 3; i++) {
    pushPart({
      x: x + (Math.random() - 0.5) * 6,
      y: y + 8,
      vx: (Math.random() - 0.5) * 30,
      vy: -10 - Math.random() * 20,
      life: 250,
      max: 250,
      r: 2,
      color: "#c8a35a",
      kind: "dust",
    });
  }
}

/** Anel de poeira no pé do Gigante (impacto de passo). */
export function spawnGiantStepDust(x: number, y: number) {
  for (let i = 0; i < 3; i++) {
    const ang = (Math.PI * 2 * i) / 3 + Math.random() * 0.4;
    pushPart({
      x: x + Math.cos(ang) * 10,
      y: y + 10 + Math.sin(ang) * 4,
      vx: Math.cos(ang) * (20 + Math.random() * 25),
      vy: -8 - Math.random() * 18,
      life: 280,
      max: 280,
      r: 2.5,
      color: "#a88850",
      kind: "dust",
    });
  }
  // rastro leve (1 part. / passo)
  pushPart({
    x: x + (Math.random() - 0.5) * 4,
    y: y + 12,
    vx: (Math.random() - 0.5) * 12,
    vy: -4 - Math.random() * 10,
    life: 320,
    max: 320,
    r: 2,
    color: "#8a7048",
    kind: "dust",
  });
}
