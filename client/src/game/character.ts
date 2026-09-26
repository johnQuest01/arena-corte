/**
 * character.ts — boneco novo desenhado por código (estilo Gungeon, 3/4).
 *
 * Camadas trocáveis (shared/cosmetics): pele, cabelo, roupa, armadura,
 * calçado e capacete. A capa (capes.ts), o escudo (shield.ts) e a arma
 * (render.ts) são desenhados em volta deste corpo.
 *
 * Coordenadas locais: origem no pivô do jogador (chão), y cresce pra baixo.
 * Tudo vetorial, sem gradiente no caminho quente — barato por frame.
 */
import {
  ARMORS,
  BOOTS,
  HAIR_COLORS,
  HELMETS,
  OUTFITS,
  SKIN_TONES,
  type ArmorDef,
  type BootsDef,
  type HelmetDef,
  type Look,
  type OutfitDef,
} from "../../../shared/cosmetics";

export const OUTLINE = "#1a1411";
const LW = 2;
/** Escala do corpo em relação ao desenho base (proporção com as armas/hitbox). */
export const CHAR_SCALE = 1.3;

/** Alturas do corpo (px mundo, relativas ao pivô). */
export const BODY = {
  sole: 9,
  ankle: 2,
  hip: -12,
  waist: -15,
  shoulder: -40,
  neck: -43,
  headY: -57,
  headR: 14,
  top: -71,
};

export interface BodyPose {
  /** ângulo da mira (rad) */
  aim: number;
  /** velocidade (px/s) — anima pernas */
  speed: number;
  /** vx normalizado (-1..1) — inclinação */
  leanX: number;
  /** ms */
  t: number;
  /** congelado = estátua */
  frozen: boolean;
  /** semente p/ piscar/respirar fora de fase */
  seed: number;
  /** Botas de Impulso (habilidade) — sobrepõe o calçado */
  impulseBoots?: boolean;
  /** Botas de Impulso ativas (chamas) */
  boosted?: boolean;
}

export interface Facing {
  /** espelhar (mira pra esquerda) */
  flip: boolean;
  /** 0 = de frente .. 1 = perfil */
  turn: number;
  /** mostrando o rosto (mira pra baixo/lados) */
  front: boolean;
  /** de costas (mira pra cima) */
  back: boolean;
  fy: number;
}

export function facingOf(aim: number): Facing {
  const fx = Math.cos(aim);
  const fy = Math.sin(aim);
  const turn = Math.min(1, Math.abs(fx) * 1.15);
  return {
    flip: fx < 0,
    turn: turn > 0.92 ? 1 : turn,
    front: fy > -0.35,
    back: fy < -0.35,
    fy,
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function capsule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function fillStroke(ctx: CanvasRenderingContext2D, fill: string, lw = LW) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* pernas + calçados                                                   */
/* ------------------------------------------------------------------ */

function drawShoe(
  ctx: CanvasRenderingContext2D,
  b: BootsDef,
  cx: number,
  footY: number,
  side: number,
  turn: number,
  impulse: boolean,
  boosted: boolean,
  t: number,
) {
  // side: +1 = pé aponta pra frente (perfil); na frente fica de "bico" pra câmera
  const len = lerp(9, 13, turn);
  const toe = turn * 4 * side;
  const w = len;
  const x0 = cx - w / 2 + toe;
  const def = impulse ? BOOTS[BOOTS.length - 1]! : b;
  // cano (altura do calçado sobe pela perna)
  const shaft =
    impulse
      ? 8
      : def.style === "combat" || def.style === "dark" || def.style === "cowboy"
        ? 9
        : def.style === "space"
          ? 8
          : def.style === "leather"
            ? 6
            : def.style === "sandal"
              ? 0
              : 2;
  if (shaft > 0) {
    capsule(ctx, cx - 4.6, footY - shaft - 2, 9.2, shaft + 3, 2.5);
    fillStroke(ctx, def.main, 1.6);
    if (def.style === "combat" || def.style === "dark") {
      // cadarço / fivela
      ctx.fillStyle = def.accent;
      for (let i = 0; i < 3; i++) ctx.fillRect(cx - 2, footY - shaft + i * 3, 4, 1);
    } else if (def.style === "cowboy") {
      ctx.fillStyle = def.accent;
      ctx.fillRect(cx - 3.5, footY - shaft + 1, 7, 1.2);
      ctx.fillRect(cx - 1, footY - shaft + 3, 2, 3);
    } else if (def.style === "space") {
      ctx.fillStyle = def.accent;
      ctx.fillRect(cx - 4, footY - 4, 8, 1.5);
    } else if (def.style === "draft" || impulse) {
      ctx.fillStyle = def.accent;
      ctx.fillRect(cx - 3.5, footY - shaft + 1, 7, 2);
    }
  }
  // pé
  if (def.style === "sandal") {
    ctx.fillStyle = SKIN_FALLBACK;
    ctx.beginPath();
    ctx.ellipse(cx + toe, footY - 1, w / 2, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    capsule(ctx, x0, footY - 0.5, w, 3, 1.5);
    fillStroke(ctx, def.main, 1.4);
    ctx.fillStyle = def.accent;
    ctx.fillRect(cx - 0.8 + toe, footY - 3.5, 1.6, 3);
    return;
  }
  capsule(ctx, x0, footY - 4.5, w, 6.5, 3);
  fillStroke(ctx, def.main, 1.6);
  // sola
  ctx.fillStyle = def.sole;
  ctx.fillRect(x0 + 1, footY, w - 2, 1.6);
  if (def.style === "sneaker") {
    ctx.fillStyle = def.accent;
    ctx.fillRect(x0 + 2, footY - 3, w - 4, 1.4);
  } else if (def.style === "cowboy") {
    ctx.fillStyle = def.sole;
    ctx.fillRect(cx - 1 - toe * 0.5, footY, 3, 2.5);
  } else if (def.style === "space") {
    ctx.fillStyle = "rgba(56,232,255,0.55)";
    ctx.fillRect(x0, footY + 1, w, 2);
  }
  // brilho
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x0 + 2, footY - 4, w * 0.4, 1);
  if ((impulse && boosted) || (def.style === "space" && boosted)) {
    // chama dos propulsores
    const f = 4 + Math.sin(t * 0.06 + cx) * 1.5;
    ctx.fillStyle = "rgba(255,170,60,0.85)";
    ctx.beginPath();
    ctx.moveTo(cx - 3, footY + 2);
    ctx.lineTo(cx, footY + 2 + f + 3);
    ctx.lineTo(cx + 3, footY + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,240,180,0.9)";
    ctx.beginPath();
    ctx.moveTo(cx - 1.5, footY + 2);
    ctx.lineTo(cx, footY + 2 + f);
    ctx.lineTo(cx + 1.5, footY + 2);
    ctx.closePath();
    ctx.fill();
  }
}

let SKIN_FALLBACK = "#e3b085";

function drawLegs(
  ctx: CanvasRenderingContext2D,
  o: OutfitDef,
  b: BootsDef,
  f: Facing,
  pose: BodyPose,
  phase: number,
  moving: boolean,
) {
  const turn = f.turn;
  const spread = lerp(5.2, 1.5, turn);
  const legs = [-1, 1];
  // no perfil, a perna "de trás" vem primeiro (mais escura)
  const order = turn > 0.5 ? [-1, 1] : legs;
  for (const i of order) {
    const ph = phase + (i > 0 ? Math.PI : 0);
    const lift = moving ? Math.max(0, Math.sin(ph)) * lerp(3.2, 2, turn) : 0;
    const swing = moving ? Math.cos(ph) * lerp(1.2, 6.5, turn) : 0;
    const x = i * spread + swing;
    const footY = BODY.sole - 2 - lift;
    const back = turn > 0.5 && i < 0;
    // calça
    const top = BODY.hip - 2;
    capsule(ctx, x - 4.3, top, 8.6, footY - top - 2, 3.5);
    fillStroke(ctx, back ? o.pantsShade : o.pants, 1.8);
    if (!back) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(x - 3, top + 2, 2, footY - top - 7);
    }
    drawShoe(ctx, b, x, footY, 1, turn, !!pose.impulseBoots, !!pose.boosted, pose.t);
  }
}

/* ------------------------------------------------------------------ */
/* tronco + roupa + armadura                                           */
/* ------------------------------------------------------------------ */

function torsoPath(ctx: CanvasRenderingContext2D, tw: number) {
  const y0 = BODY.shoulder;
  const y1 = BODY.hip + 1;
  ctx.beginPath();
  ctx.moveTo(-tw / 2 + 3, y0);
  ctx.lineTo(tw / 2 - 3, y0);
  ctx.quadraticCurveTo(tw / 2 + 1, y0 + 1, tw / 2, y0 + 6);
  ctx.lineTo(tw / 2 - 1.5, y1 - 3);
  ctx.quadraticCurveTo(tw / 2 - 2, y1, tw / 2 - 5, y1);
  ctx.lineTo(-tw / 2 + 5, y1);
  ctx.quadraticCurveTo(-tw / 2 + 2, y1, -tw / 2 + 1.5, y1 - 3);
  ctx.lineTo(-tw / 2, y0 + 6);
  ctx.quadraticCurveTo(-tw / 2 - 1, y0 + 1, -tw / 2 + 3, y0);
  ctx.closePath();
}

function drawOutfitPattern(ctx: CanvasRenderingContext2D, o: OutfitDef, tw: number, seed: number) {
  if (!o.pattern || !o.patternColor) return;
  ctx.save();
  torsoPath(ctx, tw);
  ctx.clip();
  const y0 = BODY.shoulder;
  if (o.pattern === "camo") {
    ctx.fillStyle = o.patternColor;
    const spots: [number, number, number][] = [
      [-6, 6, 4],
      [5, 12, 5],
      [-3, 20, 3.5],
      [7, 24, 3],
      [-8, 15, 2.5],
    ];
    for (const [sx, sy, sr] of spots) {
      ctx.beginPath();
      ctx.ellipse(sx, y0 + sy, sr * 1.3, sr, (seed + sx) * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (o.pattern === "quilt") {
    ctx.strokeStyle = o.patternColor;
    ctx.lineWidth = 1;
    for (let yy = y0 + 6; yy < BODY.hip; yy += 6) {
      ctx.beginPath();
      ctx.moveTo(-tw, yy);
      ctx.lineTo(tw, yy);
      ctx.stroke();
    }
  } else if (o.pattern === "trim") {
    ctx.fillStyle = o.patternColor;
    ctx.fillRect(-1.5, y0, 3, BODY.hip - y0);
    ctx.fillRect(-tw / 2, BODY.hip - 3, tw, 2);
  } else if (o.pattern === "leather") {
    ctx.strokeStyle = o.patternColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-tw / 2 + 3, y0 + 3);
    ctx.lineTo(-1, y0 + 12);
    ctx.moveTo(tw / 2 - 3, y0 + 3);
    ctx.lineTo(1, y0 + 12);
    ctx.stroke();
  } else if (o.pattern === "stripe") {
    ctx.fillStyle = o.patternColor;
    ctx.fillRect(-tw, y0 + 13, tw * 2, 3);
  }
  ctx.restore();
}

function drawTorso(ctx: CanvasRenderingContext2D, o: OutfitDef, f: Facing, breathe: number, seed: number) {
  const tw = lerp(25, 17, f.turn);
  ctx.save();
  ctx.translate(0, BODY.hip);
  ctx.scale(1, breathe);
  ctx.translate(0, -BODY.hip);
  torsoPath(ctx, tw);
  fillStroke(ctx, o.top);
  // sombra lateral (luz vem de cima-esquerda)
  ctx.save();
  torsoPath(ctx, tw);
  ctx.clip();
  ctx.fillStyle = o.topShade;
  ctx.fillRect(tw / 2 - lerp(7, 5, f.turn), BODY.shoulder, 12, 40);
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillRect(-tw / 2, BODY.shoulder + 1, tw, 2);
  ctx.restore();
  drawOutfitPattern(ctx, o, tw, seed);
  // gola / zíper (frente) — costura (costas)
  if (f.front) {
    ctx.fillStyle = o.accent;
    ctx.beginPath();
    const cx = f.turn * 6;
    ctx.moveTo(cx - 5, BODY.shoulder);
    ctx.lineTo(cx, BODY.shoulder + 7);
    ctx.lineTo(cx + 5, BODY.shoulder);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, BODY.shoulder + 7);
    ctx.lineTo(cx, BODY.hip - 1);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, BODY.shoulder + 3);
    ctx.lineTo(0, BODY.hip - 2);
    ctx.stroke();
  }
  // cinto
  ctx.fillStyle = "#231a14";
  ctx.fillRect(-tw / 2 + 1.5, BODY.hip - 4, tw - 3, 3.2);
  if (f.front) {
    ctx.fillStyle = "#c9a45a";
    ctx.fillRect(f.turn * 5 - 2, BODY.hip - 4.2, 4, 3.6);
  }
  ctx.restore();
}

function drawSleeves(ctx: CanvasRenderingContext2D, o: OutfitDef, _skin: string, f: Facing, which: "back" | "front" | "both") {
  const tw = lerp(25, 17, f.turn);
  const arms: number[] = which === "both" ? [-1, 1] : which === "back" ? [-1] : [1];
  for (const i of arms) {
    // no perfil, braço de trás fica escondido pelo tronco
    const x = i * (tw / 2 + 1.5) - (f.turn > 0.5 ? i * 3 : 0);
    capsule(ctx, x - 3.6, BODY.shoulder + 1, 7.2, 14, 3.6);
    fillStroke(ctx, i < 0 && f.turn > 0.5 ? o.topShade : o.top, 1.8);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(x - 3, BODY.shoulder + 11, 6, 2);
  }
}

function drawArmor(ctx: CanvasRenderingContext2D, a: ArmorDef, f: Facing, t: number) {
  if (a.style === "none") return;
  const tw = lerp(25, 17, f.turn);
  const y0 = BODY.shoulder;
  const pauldron = (x: number, r: number, col: string) => {
    ctx.beginPath();
    ctx.ellipse(x, y0 + 3, r, r * 0.8, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(x + r, y0 + 5);
    ctx.lineTo(x - r, y0 + 5);
    ctx.closePath();
    fillStroke(ctx, col, 1.6);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(x - r * 0.6, y0 + 0.5, r * 0.8, 1.2);
  };
  const plate = (col: string, shade: string, inset = 2, h = 20) => {
    capsule(ctx, -tw / 2 + inset, y0 + 2, tw - inset * 2, h, 5);
    fillStroke(ctx, col, 1.7);
    ctx.save();
    capsule(ctx, -tw / 2 + inset, y0 + 2, tw - inset * 2, h, 5);
    ctx.clip();
    ctx.fillStyle = shade;
    ctx.fillRect(tw / 2 - 7, y0, 10, h + 4);
    ctx.restore();
  };
  switch (a.style) {
    case "vest": {
      plate(a.main, a.shade, 1.5, 22);
      // bolsos
      for (let i = -1; i <= 1; i++) {
        if (f.turn > 0.6 && i < 0) continue;
        capsule(ctx, i * 6.5 - 3 + f.turn * 3, y0 + 13, 6, 7, 1.5);
        fillStroke(ctx, a.trim, 1.2);
      }
      ctx.fillStyle = a.trim;
      ctx.fillRect(-tw / 2 + 3, y0 + 1, 3, 4);
      ctx.fillRect(tw / 2 - 6, y0 + 1, 3, 4);
      break;
    }
    case "plate":
    case "gold": {
      plate(a.main, a.shade, 1.5, 21);
      ctx.strokeStyle = a.trim;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(f.turn * 5, y0 + 4);
      ctx.lineTo(f.turn * 5, y0 + 20);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(-tw / 2 + 4, y0 + 5, 4, 8);
      pauldron(-tw / 2 + 1, 6, a.main);
      if (f.turn < 0.6) pauldron(tw / 2 - 1, 6, a.main);
      if (a.style === "gold") {
        ctx.fillStyle = "#c0282c";
        ctx.beginPath();
        ctx.arc(f.turn * 5, y0 + 10, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "knight": {
      plate(a.main, a.shade, 1, 23);
      ctx.strokeStyle = a.trim;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-tw / 2 + 3, y0 + 3);
      ctx.lineTo(tw / 2 - 3, y0 + 3);
      ctx.stroke();
      // saiote de placas
      for (let i = -1; i <= 1; i++) {
        capsule(ctx, i * 7 - 3.5, BODY.hip - 5, 7, 8, 2);
        fillStroke(ctx, a.shade, 1.2);
      }
      ctx.fillStyle = "rgba(255,255,255,0.38)";
      ctx.fillRect(-tw / 2 + 4, y0 + 5, 3.5, 10);
      pauldron(-tw / 2 + 1, 7.5, a.main);
      if (f.turn < 0.6) pauldron(tw / 2 - 1, 7.5, a.main);
      ctx.fillStyle = a.trim;
      if (f.front) {
        // cruz no peito
        ctx.fillRect(f.turn * 5 - 1, y0 + 7, 2, 9);
        ctx.fillRect(f.turn * 5 - 4, y0 + 10, 8, 2);
      }
      break;
    }
    case "neon": {
      plate(a.main, a.shade, 1.5, 22);
      const pulse = 0.65 + 0.35 * Math.sin(t * 0.006);
      ctx.strokeStyle = a.glow!;
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-tw / 2 + 4, y0 + 5);
      ctx.lineTo(f.turn * 5, y0 + 14);
      ctx.lineTo(tw / 2 - 4, y0 + 5);
      ctx.moveTo(-tw / 2 + 4, y0 + 19);
      ctx.lineTo(tw / 2 - 4, y0 + 19);
      ctx.stroke();
      ctx.globalAlpha = pulse * 0.35;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.globalAlpha = 1;
      pauldron(-tw / 2 + 1, 6, a.trim);
      if (f.turn < 0.6) pauldron(tw / 2 - 1, 6, a.trim);
      break;
    }
    case "bone": {
      plate(a.main, a.shade, 2, 21);
      ctx.strokeStyle = a.trim;
      ctx.lineWidth = 1.3;
      for (let i = 0; i < 4; i++) {
        const yy = y0 + 6 + i * 4;
        ctx.beginPath();
        ctx.moveTo(-tw / 2 + 4, yy + 1);
        ctx.quadraticCurveTo(f.turn * 5, yy - 2, tw / 2 - 4, yy + 1);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(f.turn * 5, y0 + 4);
      ctx.lineTo(f.turn * 5, y0 + 21);
      ctx.stroke();
      pauldron(-tw / 2 + 1, 5.5, a.main);
      if (f.turn < 0.6) pauldron(tw / 2 - 1, 5.5, a.main);
      break;
    }
    case "dark": {
      // Couraça Sombria (inspirada no Darth Vader)
      plate(a.main, a.shade, 1, 23);
      pauldron(-tw / 2 + 1, 7, a.main);
      if (f.turn < 0.6) pauldron(tw / 2 - 1, 7, a.main);
      // ombreira/colar largo
      ctx.fillStyle = "#26282e";
      ctx.beginPath();
      ctx.ellipse(0, y0 + 2, tw / 2 + 1, 5, 0, 0, Math.PI);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (f.front) {
        // painel de controle no peito com luzes
        const px = f.turn * 5 - 5.5;
        capsule(ctx, px, y0 + 8, 11, 9, 1.5);
        fillStroke(ctx, "#3c3f47", 1.2);
        const blink = Math.sin(t * 0.004) > 0;
        const lights = ["#e8403a", blink ? "#48e070" : "#1f5a30", "#4a8cff", "#e8403a", "#d8d8d8", blink ? "#1f5a30" : "#48e070"];
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = lights[i]!;
          ctx.fillRect(px + 1.8 + (i % 3) * 3, y0 + 10 + Math.floor(i / 3) * 3.5, 2, 2);
        }
        // cinto com caixinhas
        ctx.fillStyle = "#8a8f9a";
        ctx.fillRect(px - 1, BODY.hip - 4.5, 3, 3.2);
        ctx.fillRect(px + 4, BODY.hip - 4.5, 3, 3.2);
        ctx.fillRect(px + 9, BODY.hip - 4.5, 3, 3.2);
      }
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(-tw / 2 + 4, y0 + 5, 3, 8);
      break;
    }
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* cabeça, cabelo, capacetes                                           */
/* ------------------------------------------------------------------ */

function fullHelmet(h: HelmetDef) {
  return h.style === "knight" || h.style === "darkLord";
}

function drawHairBack(ctx: CanvasRenderingContext2D, style: number, col: string, f: Facing) {
  // partes do cabelo que ficam ATRÁS da cabeça (longo / cacheado / rabo)
  const hy = BODY.headY;
  const r = BODY.headR;
  if (style === 2) {
    capsule(ctx, -r + 1 - f.turn * 4, hy - 4, r * 2 - 2, r + 14, 7);
    fillStroke(ctx, col);
  } else if (style === 5) {
    ctx.beginPath();
    ctx.arc(-f.turn * 3, hy - 3, r + 5, 0, Math.PI * 2);
    fillStroke(ctx, col);
  } else if (style === 4 && (f.back || f.turn > 0.4)) {
    const tx = f.back ? 0 : -r + 1;
    ctx.beginPath();
    ctx.ellipse(tx, hy + 8, 4, 9, f.back ? 0 : 0.35, 0, Math.PI * 2);
    fillStroke(ctx, col, 1.6);
  }
}

function drawHairFront(ctx: CanvasRenderingContext2D, style: number, col: string, f: Facing) {
  const hy = BODY.headY;
  const r = BODY.headR;
  const hi = "rgba(255,255,255,0.18)";
  ctx.save();
  if (style === 3) {
    // careca: só o brilho
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.ellipse(-4, hy - 9, 4, 2, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (f.back) {
    // nuca coberta
    ctx.beginPath();
    ctx.arc(0, hy, r + 0.5, Math.PI * 0.95, Math.PI * 2.05);
    ctx.lineTo(r, hy + 5);
    ctx.quadraticCurveTo(0, hy + 9, -r, hy + 5);
    ctx.closePath();
    fillStroke(ctx, col);
  } else {
    // franja: topo da cabeça + mecha que desce do lado de trás
    const shift = f.turn * 5;
    ctx.beginPath();
    ctx.moveTo(-r - 0.5, hy + 2);
    ctx.arc(0, hy, r + 0.8, Math.PI * 1.0, Math.PI * 2.0);
    ctx.lineTo(r + 0.5, hy - 1 + f.turn * 3);
    ctx.quadraticCurveTo(shift + 6, hy - 6, shift + 2, hy - 4);
    ctx.quadraticCurveTo(shift - 3, hy - 8, shift - 7, hy - 3);
    ctx.quadraticCurveTo(-r + 3, hy - 4, -r - 0.5, hy + 2 + f.turn * 6);
    ctx.closePath();
    fillStroke(ctx, col);
  }
  if (style === 1) {
    // moicano: crista alta
    ctx.beginPath();
    ctx.moveTo(-3 + f.turn * 2, hy - r + 2);
    ctx.lineTo(-1 + f.turn * 2, hy - r - 9);
    ctx.lineTo(3 + f.turn * 3, hy - r - 7);
    ctx.lineTo(5 + f.turn * 3, hy - r + 3);
    ctx.closePath();
    fillStroke(ctx, col, 1.6);
  } else if (style === 6) {
    // espetado
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (1.1 + i * 0.2);
      const bx = Math.cos(a) * (r - 1);
      const by = hy + Math.sin(a) * (r - 1);
      ctx.moveTo(bx - 3, by + 2);
      ctx.lineTo(bx + Math.cos(a) * 7, by + Math.sin(a) * 7);
      ctx.lineTo(bx + 3, by + 2);
    }
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  } else if (style === 5) {
    // cacheado: bolinhas por cima
    ctx.fillStyle = col;
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (1.05 + i * 0.18);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (r + 1), hy + Math.sin(a) * (r + 1), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.ellipse(-4, hy - r + 3, 5, 1.6, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, f: Facing, t: number, seed: number, skinShade: string) {
  const hy = BODY.headY;
  const shift = f.turn * 6;
  const blink = (Math.floor(t / 90) + seed * 13) % 42 === 0;
  const eyeY = hy + 1;
  const eyes = f.turn > 0.85 ? [shift + 2.5] : [shift - 5, shift + 5 - f.turn * 2];
  for (const ex of eyes) {
    if (blink) {
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(ex - 2, eyeY, 4, 1.2);
      continue;
    }
    ctx.fillStyle = "#1b1512";
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 2, 2.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(ex - 0.9, eyeY - 1.9, 1.3, 1.3);
  }
  // bochecha / boca
  ctx.fillStyle = "rgba(220,90,80,0.18)";
  ctx.beginPath();
  ctx.ellipse(shift + (f.turn > 0.85 ? 0 : 7), hy + 6, 2.6, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = skinShade;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(shift - 1.5 + (f.turn > 0.85 ? 3 : 0), hy + 7.5);
  ctx.lineTo(shift + 1.5 + (f.turn > 0.85 ? 3 : 0), hy + 7.5);
  ctx.stroke();
  if (f.turn > 0.5) {
    // orelha
    ctx.fillStyle = skinShade;
    ctx.beginPath();
    ctx.ellipse(-3, hy + 1, 2.4, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHelmet(ctx: CanvasRenderingContext2D, h: HelmetDef, f: Facing, t: number) {
  const hy = BODY.headY;
  const r = BODY.headR;
  const shift = f.turn * 6;
  switch (h.style) {
    case "cap": {
      ctx.beginPath();
      ctx.arc(0, hy - 1, r + 1, Math.PI, Math.PI * 2);
      ctx.lineTo(r + 1, hy + 1);
      ctx.lineTo(-r - 1, hy + 1);
      ctx.closePath();
      fillStroke(ctx, h.main);
      // aba
      ctx.beginPath();
      if (f.back) ctx.ellipse(0, hy + 1, r * 0.8, 2.5, 0, 0, Math.PI * 2);
      else ctx.ellipse(shift + f.turn * 8, hy + 1, r * 0.95 - f.turn * 2, 3.2, 0, 0, Math.PI * 2);
      fillStroke(ctx, h.shade, 1.6);
      if (f.front) {
        ctx.fillStyle = h.accent;
        ctx.beginPath();
        ctx.arc(shift, hy - 7, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "army": {
      ctx.beginPath();
      ctx.arc(0, hy - 1, r + 2.5, Math.PI * 0.98, Math.PI * 2.02);
      ctx.lineTo(r + 3, hy + 3);
      ctx.lineTo(-r - 3, hy + 3);
      ctx.closePath();
      fillStroke(ctx, h.main);
      ctx.fillStyle = h.shade;
      ctx.fillRect(-r - 3, hy + 0.5, (r + 3) * 2, 2.5);
      ctx.fillStyle = h.accent;
      ctx.fillRect(-r + 2, hy - 7, r * 2 - 4, 2);
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath();
      ctx.ellipse(-5, hy - r + 1, 5, 2, -0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "knight": {
      capsule(ctx, -r - 1, hy - r - 2, (r + 1) * 2, r * 2 + 6, 9);
      fillStroke(ctx, h.main);
      ctx.save();
      capsule(ctx, -r - 1, hy - r - 2, (r + 1) * 2, r * 2 + 6, 9);
      ctx.clip();
      ctx.fillStyle = h.shade;
      ctx.fillRect(r - 5, hy - r - 4, 10, r * 2 + 12);
      ctx.restore();
      if (!f.back) {
        // viseira
        ctx.fillStyle = "#0d0d10";
        ctx.fillRect(shift - 9 + f.turn * 3, hy - 1, 18 - f.turn * 6, 3);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        for (let i = 0; i < 3; i++) ctx.fillRect(shift - 3 + i * 3, hy + 5, 1.2, 3);
        ctx.strokeStyle = h.shade;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(shift, hy - r);
        ctx.lineTo(shift, hy - 2);
        ctx.stroke();
      }
      // pluma
      const sway = Math.sin(t * 0.005) * 2;
      ctx.beginPath();
      ctx.moveTo(-2, hy - r - 1);
      ctx.quadraticCurveTo(-6 + sway, hy - r - 14, -16 + sway, hy - r - 8);
      ctx.quadraticCurveTo(-10 + sway, hy - r - 6, -4, hy - r + 2);
      ctx.closePath();
      fillStroke(ctx, h.accent, 1.5);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(-6, hy - r + 3, 6, 1.5);
      break;
    }
    case "darkLord": {
      // Elmo Sombrio — domo + "saia" que desce até os ombros + máscara (inspirado no Darth Vader)
      ctx.beginPath();
      ctx.moveTo(-r - 1.5, hy - 1);
      ctx.arc(0, hy - 1, r + 1.5, Math.PI, Math.PI * 2);
      ctx.quadraticCurveTo(r + 2.5, hy + 6, r + 4.5, hy + 13);
      ctx.quadraticCurveTo(0, hy + 16, -r - 4.5, hy + 13);
      ctx.quadraticCurveTo(-r - 2.5, hy + 6, -r - 1.5, hy - 1);
      ctx.closePath();
      fillStroke(ctx, h.main);
      // aba da testa
      ctx.strokeStyle = "rgba(120,128,142,0.45)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, hy - 1, r + 0.5, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      // brilho do domo
      ctx.fillStyle = "rgba(190,200,220,0.35)";
      ctx.beginPath();
      ctx.ellipse(-4, hy - r + 2, 6, 2.4, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(160,170,190,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, hy - r - 1);
      ctx.lineTo(0, hy - 5);
      ctx.stroke();
      if (!f.back) {
        const mx = shift * 0.8;
        // máscara (maçãs angulosas)
        ctx.beginPath();
        ctx.moveTo(mx - 10, hy - 4);
        ctx.lineTo(mx + 10, hy - 4);
        ctx.lineTo(mx + 8.5, hy + 8);
        ctx.lineTo(mx + 3.5, hy + 14);
        ctx.lineTo(mx - 3.5, hy + 14);
        ctx.lineTo(mx - 8.5, hy + 8);
        ctx.closePath();
        fillStroke(ctx, "#202229", 1.4);
        // lentes
        ctx.fillStyle = "#040405";
        ctx.beginPath();
        ctx.moveTo(mx - 9, hy - 3);
        ctx.lineTo(mx - 1.5, hy - 2);
        ctx.lineTo(mx - 2.5, hy + 3);
        ctx.lineTo(mx - 8.5, hy + 2);
        ctx.closePath();
        ctx.moveTo(mx + 9, hy - 3);
        ctx.lineTo(mx + 1.5, hy - 2);
        ctx.lineTo(mx + 2.5, hy + 3);
        ctx.lineTo(mx + 8.5, hy + 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(230,70,60,0.4)";
        ctx.fillRect(mx - 7, hy - 1.8, 2.2, 1.1);
        ctx.fillRect(mx + 4.8, hy - 1.8, 2.2, 1.1);
        // nariz + grade triangular da boca
        ctx.fillStyle = h.accent;
        ctx.fillRect(mx - 0.8, hy - 1, 1.6, 5);
        ctx.beginPath();
        ctx.moveTo(mx - 5, hy + 6);
        ctx.lineTo(mx + 5, hy + 6);
        ctx.lineTo(mx, hy + 13);
        ctx.closePath();
        ctx.fillStyle = "#3c3f48";
        ctx.fill();
        ctx.strokeStyle = h.accent;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = -3.5; i <= 3.5; i += 1.75) {
          ctx.moveTo(mx + i, hy + 6.5);
          ctx.lineTo(mx + i * 0.25, hy + 12);
        }
        ctx.stroke();
      }
      break;
    }
    case "bandana": {
      ctx.fillStyle = h.main;
      ctx.beginPath();
      ctx.arc(0, hy - 1, r + 0.8, Math.PI * 1.02, Math.PI * 1.98);
      ctx.lineTo(r, hy - 3);
      ctx.lineTo(-r, hy - 3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = h.shade;
      ctx.fillRect(-r, hy - 5, r * 2, 2.5);
      if (!f.front || f.turn > 0.4) {
        // nó e pontas
        ctx.beginPath();
        ctx.moveTo(-r + 1, hy - 4);
        ctx.lineTo(-r - 7, hy + 2);
        ctx.lineTo(-r - 3, hy + 4);
        ctx.closePath();
        fillStroke(ctx, h.main, 1.3);
      }
      ctx.fillStyle = h.accent;
      for (let i = -2; i <= 2; i++) ctx.fillRect(shift + i * 4, hy - 8, 1.5, 1.5);
      break;
    }
    case "hood": {
      ctx.beginPath();
      ctx.arc(0, hy - 1, r + 3.5, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(r + 5, hy + 12);
      ctx.lineTo(-r - 5, hy + 12);
      ctx.closePath();
      fillStroke(ctx, h.main);
      if (!f.back) {
        // rosto na sombra
        ctx.fillStyle = "rgba(10,8,8,0.55)";
        ctx.beginPath();
        ctx.ellipse(shift, hy + 2, 9 - f.turn * 2, 10, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = h.accent;
      ctx.fillRect(-r - 3, hy + 9, (r + 3) * 2, 2);
      break;
    }
    case "crown": {
      const y = hy - r + 1;
      ctx.beginPath();
      ctx.moveTo(-9, y + 5);
      ctx.lineTo(-9, y - 4);
      ctx.lineTo(-5, y);
      ctx.lineTo(0, y - 7);
      ctx.lineTo(5, y);
      ctx.lineTo(9, y - 4);
      ctx.lineTo(9, y + 5);
      ctx.closePath();
      fillStroke(ctx, h.main, 1.5);
      ctx.fillStyle = h.accent;
      ctx.beginPath();
      ctx.arc(0, y + 1.5, 1.8, 0, Math.PI * 2);
      ctx.arc(-6, y + 2.5, 1.3, 0, Math.PI * 2);
      ctx.arc(6, y + 2.5, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(-8, y + 3.5, 5, 1);
      break;
    }
    case "visor": {
      ctx.beginPath();
      ctx.arc(0, hy - 1, r + 1.5, Math.PI, Math.PI * 2);
      ctx.lineTo(r + 1.5, hy + 2);
      ctx.lineTo(-r - 1.5, hy + 2);
      ctx.closePath();
      fillStroke(ctx, h.main);
      if (!f.back) {
        const pulse = 0.7 + 0.3 * Math.sin(t * 0.008);
        ctx.fillStyle = h.accent;
        ctx.globalAlpha = pulse;
        capsule(ctx, shift - 10 + f.turn * 3, hy - 3, 20 - f.turn * 5, 5, 2.5);
        ctx.fill();
        ctx.globalAlpha = pulse * 0.3;
        capsule(ctx, shift - 12 + f.turn * 3, hy - 5, 24 - f.turn * 5, 9, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = h.accent;
        ctx.fillRect(-2, hy - r, 4, r - 2);
      }
      break;
    }
    default:
      break;
  }
}

function drawHead(ctx: CanvasRenderingContext2D, look: Look, f: Facing, t: number, seed: number) {
  const skin = SKIN_TONES[look.skin] ?? SKIN_TONES[1]!;
  const hairCol = (HAIR_COLORS[look.hairColor] ?? HAIR_COLORS[0]!).color;
  const helm = HELMETS[look.helmet] ?? HELMETS[0]!;
  const hy = BODY.headY;
  const r = BODY.headR;
  const covered = fullHelmet(helm);
  // pescoço
  ctx.fillStyle = skin.shade;
  ctx.fillRect(-3.5, BODY.neck - 1, 7, 5);
  if (!covered && helm.style !== "hood" && f.back) drawHairBack(ctx, look.hair, hairCol, f);
  if (!covered) {
    ctx.beginPath();
    ctx.arc(0, hy, r, 0, Math.PI * 2);
    fillStroke(ctx, skin.color);
    // sombra do lado direito do rosto
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, hy, r - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = skin.shade;
    ctx.beginPath();
    ctx.arc(r * 0.9, hy + 3, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (f.front && helm.style !== "hood") drawFace(ctx, f, t, seed, skin.shade);
    if (helm.style === "none" || helm.style === "crown" || helm.style === "bandana") {
      drawHairFront(ctx, look.hair, hairCol, f);
    }
  }
  if (helm.style !== "none") drawHelmet(ctx, helm, f, t);
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Corpo completo (sem capa/escudo/arma), na origem atual do ctx (pivô).
 * `gunIsBehind`: o chamador desenha a arma antes/depois; aqui só o corpo.
 */
export function drawBody(ctx: CanvasRenderingContext2D, look: Look, pose: BodyPose) {
  const outfit = OUTFITS[look.outfit] ?? OUTFITS[0]!;
  const armor = ARMORS[look.armor] ?? ARMORS[0]!;
  const boots = BOOTS[look.boots] ?? BOOTS[0]!;
  const skin = (SKIN_TONES[look.skin] ?? SKIN_TONES[1]!).color;
  SKIN_FALLBACK = skin;
  const f = facingOf(pose.aim);
  const moving = !pose.frozen && pose.speed > 25;
  const phase = moving ? (pose.t * 0.0125 * Math.max(0.7, Math.min(2.2, pose.speed / 170))) % (Math.PI * 2) : 0;
  const bob = moving ? -Math.abs(Math.sin(phase)) * 2.2 : 0;
  const breathe = pose.frozen ? 1 : moving ? 1 : 1 + Math.sin(pose.t * 0.004 + pose.seed) * 0.018;
  const lean = pose.frozen ? 0 : Math.max(-0.09, Math.min(0.09, pose.leanX * 0.09));

  ctx.save();
  ctx.scale(CHAR_SCALE, CHAR_SCALE);
  if (f.flip) ctx.scale(-1, 1);
  const leanDir = f.flip ? -lean : lean;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  drawLegs(ctx, outfit, boots, f, pose, phase, moving);
  ctx.translate(0, bob);
  // inclinação no quadril (tronco + cabeça)
  ctx.translate(0, BODY.hip);
  ctx.rotate(leanDir);
  ctx.translate(0, -BODY.hip);
  const helm = HELMETS[look.helmet] ?? HELMETS[0]!;
  if (f.front && !fullHelmet(helm) && helm.style !== "hood") {
    // cabelo longo/cacheado fica ATRÁS do corpo quando de frente
    ctx.save();
    ctx.translate(0, 0);
    drawHairBack(ctx, look.hair, (HAIR_COLORS[look.hairColor] ?? HAIR_COLORS[0]!).color, f);
    ctx.restore();
  }
  if (f.turn > 0.5) drawSleeves(ctx, outfit, skin, f, "back");
  drawTorso(ctx, outfit, f, breathe, pose.seed);
  drawArmor(ctx, armor, f, pose.t);
  drawSleeves(ctx, outfit, skin, f, f.turn > 0.5 ? "front" : "both");
  drawHead(ctx, look, f, pose.t, pose.seed);
  ctx.restore();
}

/** Ponto de ancoragem da capa (nuca/ombros) relativo ao pivô. */
export function capeAnchor(aim: number): { x: number; y: number; w: number } {
  const f = facingOf(aim);
  const back = Math.cos(aim) < 0 ? 1 : -1;
  return {
    x: back * f.turn * 5 * CHAR_SCALE,
    y: (BODY.shoulder + 3) * CHAR_SCALE,
    w: lerp(24, 12, f.turn) * CHAR_SCALE,
  };
}

/** Pele (mãos na arma). */
export function skinColorOf(look: Look): string {
  return (SKIN_TONES[look.skin] ?? SKIN_TONES[1]!).color;
}
