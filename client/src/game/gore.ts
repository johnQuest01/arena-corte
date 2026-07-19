/**
 * gore.ts — sangue, gibs, cadáveres, decals (client-only).
 */
import { LOADOUTS } from "../../../shared/gear";
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

const MAX_PARTS = 400;
const particles: Particle[] = [];
const gibs: Gib[] = [];
const corpses: Corpse[] = [];
const flashHit = new Map<number, number>(); // playerId → untilMs

let decal: HTMLCanvasElement | null = null;
let dctx: CanvasRenderingContext2D | null = null;
let decalCount = 0;
const MAX_DECALS = 300;

export function initDecals(w: number, h: number) {
  if (!decal || decal.width !== w || decal.height !== h) {
    decal = document.createElement("canvas");
    decal.width = w;
    decal.height = h;
    dctx = decal.getContext("2d");
  }
}

export function clearDecals() {
  if (dctx && decal) dctx.clearRect(0, 0, decal.width, decal.height);
  decalCount = 0;
  particles.length = 0;
  gibs.length = 0;
  corpses.length = 0;
  flashHit.clear();
}

function pushPart(p: Particle) {
  particles.push(p);
  while (particles.length > MAX_PARTS) particles.shift();
}

function stampDecal(x: number, y: number, r: number, color: string, a = 0.55) {
  if (!dctx || !decal) return;
  if (decalCount >= MAX_DECALS) {
    // sobrescreve região aleatória leve
    dctx.globalCompositeOperation = "destination-out";
    dctx.fillStyle = "rgba(0,0,0,0.08)";
    dctx.fillRect(Math.random() * decal.width, Math.random() * decal.height, 40, 40);
    dctx.globalCompositeOperation = "source-over";
  }
  dctx.fillStyle = color;
  dctx.globalAlpha = a;
  dctx.beginPath();
  dctx.ellipse(x, y, r, r * 0.65, Math.random() * Math.PI, 0, Math.PI * 2);
  dctx.fill();
  dctx.globalAlpha = 1;
  decalCount++;
}

export function stampBulletMark(x: number, y: number) {
  stampDecal(x, y, 2, "#1a1410", 0.75);
}

export function stampShell(x: number, y: number) {
  stampDecal(x, y, 1.2, "#c8a060", 0.7);
}

function lookOf(id: number) {
  return LOADOUTS[id % LOADOUTS.length]!;
}

export function processGoreEvents(events: TickEvent[], now: number) {
  for (const e of events) {
    if (e.kind === "hit" && e.b !== 255) {
      const dir = Math.atan2(e.y - (e.y - 1), e.x); // fallback
      void dir;
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
    }
    if (e.kind === "death") {
      const cause = e.weaponId ?? 0;
      const look = lookOf(e.b);
      if (cause === 100) {
        // explosão — despedaça
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
          const sp = 80 + Math.random() * 180;
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
}

export function hitFlashActive(id: number, now: number) {
  return (flashHit.get(id) ?? 0) > now;
}

export function drawDecalLayer(ctx: CanvasRenderingContext2D) {
  if (decal) ctx.drawImage(decal, 0, 0);
}

export function drawGoreActors(ctx: CanvasRenderingContext2D) {
  for (const c of corpses) {
    const look = lookOf(c.id);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = look.pants;
    ctx.fillRect(-6, -3, 14, 5);
    ctx.fillStyle = look.shirt;
    ctx.fillRect(-8, -5, 12, 7);
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.arc(-10, 0, 4, 0, Math.PI * 2);
    ctx.fill();
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
