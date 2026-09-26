/**
 * guns.ts — armas desenhadas em código (estilo do boneco: contorno escuro,
 * 2–3 tons, brilho). Mesma geometria do jogo: a boca do cano cai exatamente
 * em gunBarrelLocal (de onde a bala sai no host) — só o desenho muda.
 *
 * Coordenadas locais (iguais ao sprite antigo): (0,0) = mão traseira,
 * +X = cano, +Y = "baixo" da arma. Quem chama gira pela mira e espelha
 * no eixo Y quando mira pra esquerda.
 */
import { gunBarrelLocal, GUN_VISUAL_SCALE, weaponOf } from "../../../shared/gear";

const OUT = "#15110f";

export interface GunGeom {
  /** traseira da arma (x local) */
  x0: number;
  /** boca do cano */
  tipX: number;
  tipY: number;
  /** traseira → boca */
  len: number;
}

const geomCache = new Map<number, GunGeom>();

export function gunGeom(weaponId: number): GunGeom {
  let g = geomCache.get(weaponId);
  if (!g) {
    const w = weaponOf(weaponId);
    const tip = gunBarrelLocal(w);
    const x0 = -(w.gripInset ?? 4) * GUN_VISUAL_SCALE;
    g = { x0, tipX: tip.x, tipY: tip.y, len: tip.x - x0 };
    geomCache.set(weaponId, g);
  }
  return g;
}

/** Onde as mãos seguram (mão traseira no punho; a da frente no guarda-mão/pump). */
export function gunHandPoints(weaponId: number): { rear: [number, number]; front: [number, number] } {
  const g = gunGeom(weaponId);
  const at = (u: number) => g.x0 + u * g.len;
  switch (weaponId) {
    case 0: // pistola: duas mãos no cabo
      return { rear: [1, 2.5], front: [4.5, 4] };
    case 4: // escopeta: mão no pump
      return { rear: [1, 2.5], front: [at(0.6), g.tipY + 5] };
    case 5: // SMG (tipo Uzi): mão de apoio embaixo do receptor
      return { rear: [1, 2.5], front: [at(0.56), g.tipY + 5.5] };
    case 6: // sniper: guarda-mão longo
      return { rear: [1, 2.5], front: [at(0.5), g.tipY + 5] };
    default: // fuzis
      return { rear: [1, 2.5], front: [at(0.6), g.tipY + 4.5] };
  }
}

type Pt = [number, number];

function poly(g: CanvasRenderingContext2D, pts: Pt[], fill: string, lw = 1.2) {
  g.beginPath();
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = OUT;
  g.stroke();
}

function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, r = 1.2, lw = 1.2) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  // volume: sombra embaixo + luz em cima (peças com altura suficiente)
  if (h >= 4 && w >= 4) {
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.fillRect(x + 1, y + h * 0.62, w - 2, h * 0.3);
    g.fillStyle = "rgba(255,255,255,0.09)";
    g.fillRect(x + 1, y + 1, w - 2, h * 0.24);
  }
  if (lw > 0) {
    g.lineWidth = lw;
    g.strokeStyle = OUT;
    g.stroke();
  }
}

/** pino / parafuso */
function pin(g: CanvasRenderingContext2D, x: number, y: number, r = 0.7) {
  g.fillStyle = "rgba(210,215,225,0.55)";
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** veios de madeira (curvas finas) */
function grain(g: CanvasRenderingContext2D, x1: number, x2: number, y: number, col: string, n = 2, gap = 2.4) {
  g.strokeStyle = col;
  g.lineWidth = 0.7;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const yy = y + i * gap;
    g.moveTo(x1, yy);
    g.bezierCurveTo(x1 + (x2 - x1) * 0.3, yy - 0.8, x1 + (x2 - x1) * 0.6, yy + 0.9, x2, yy);
  }
  g.stroke();
}

/** faixa de brilho no topo (metal/madeira) */
function shine(g: CanvasRenderingContext2D, x1: number, x2: number, y: number, a = 0.35) {
  g.strokeStyle = `rgba(255,255,255,${a})`;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x1, y);
  g.lineTo(x2, y);
  g.stroke();
}

function ticks(g: CanvasRenderingContext2D, x1: number, x2: number, y1: number, y2: number, step: number, col = "rgba(0,0,0,0.45)") {
  g.strokeStyle = col;
  g.lineWidth = 0.8;
  g.beginPath();
  for (let x = x1; x <= x2; x += step) {
    g.moveTo(x, y1);
    g.lineTo(x, y2);
  }
  g.stroke();
}

function muzzleHole(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.fillStyle = "#050404";
  g.beginPath();
  g.ellipse(x, y, r * 0.45, r, 0, 0, Math.PI * 2);
  g.fill();
}

export interface GunArtOpts {
  /** pente fora (recarga) */
  magOut?: boolean;
  /** relógio (brilho da luneta) */
  t?: number;
}

/** Desenha a arma (sem mãos). */
export function drawGunArt(g: CanvasRenderingContext2D, weaponId: number, o: GunArtOpts = {}) {
  const G = gunGeom(weaponId);
  const L = G.len;
  const x0 = G.x0;
  const bx = G.tipX;
  const by = G.tipY;
  const at = (u: number) => x0 + u * L;
  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";
  switch (weaponId) {
    case 0:
      drawPistol(g, x0, bx, by);
      break;
    case 1:
      drawM4(g, at, bx, by, o);
      break;
    case 2:
      drawM16(g, at, bx, by, o);
      break;
    case 3:
      drawAK(g, at, bx, by, o);
      break;
    case 4:
      drawShotgun(g, at, bx, by);
      break;
    case 5:
      drawSMG(g, at, bx, by, o);
      break;
    case 6:
      drawSniper(g, at, bx, by, o);
      break;
    default:
      drawM4(g, at, bx, by, o);
  }
  g.restore();
}

/* ---------------- pistola (tipo Glock) ---------------- */
function drawPistol(g: CanvasRenderingContext2D, x0: number, bx: number, by: number) {
  // cabo (inclinado pra trás) — a mão cobre o topo
  poly(g, [
    [x0 + 3.5, by + 3],
    [x0 + 12.5, by + 3],
    [x0 + 10.5, by + 17.5],
    [x0 + 1.5, by + 16.5],
  ], "#2a2c31");
  // textura do cabo
  g.fillStyle = "rgba(255,255,255,0.08)";
  for (let i = 0; i < 4; i++) g.fillRect(x0 + 4 + i * 0.3, by + 7 + i * 2.4, 5, 0.9);
  // guarda-mato
  g.strokeStyle = OUT;
  g.lineWidth = 1.3;
  g.beginPath();
  g.moveTo(x0 + 12, by + 4);
  g.quadraticCurveTo(x0 + 13, by + 10, x0 + 19, by + 9);
  g.lineTo(x0 + 21, by + 4);
  g.stroke();
  g.fillStyle = "#101012";
  g.fillRect(x0 + 14.5, by + 4, 1.4, 3.2);
  // armação
  box(g, x0 + 9, by + 1.5, bx - x0 - 12, 4.2, "#2f3237", 1.5);
  // ferrolho (slide)
  box(g, x0 + 1.5, by - 5, bx - x0 - 1.5, 7.5, "#474b54", 1.6);
  shine(g, x0 + 3, bx - 2, by - 3.6, 0.4);
  // serrilhado traseiro + janela de ejeção
  ticks(g, x0 + 3.5, x0 + 8.5, by - 4, by + 1.5, 1.3);
  g.fillStyle = "#1c1d21";
  g.fillRect(x0 + 13, by - 3.8, 6, 2.2);
  // miras
  g.fillStyle = OUT;
  g.fillRect(x0 + 3, by - 6.8, 3, 2);
  g.fillRect(bx - 4, by - 6.8, 2, 2);
  muzzleHole(g, bx - 0.3, by - 0.8, 1.6);
}

/* ---------------- M4A1 (flat-top, trilho, coronha retrátil) ---------------- */
function drawM4(g: CanvasRenderingContext2D, at: (u: number) => number, bx: number, by: number, o: GunArtOpts) {
  const metal = "#343841";
  const dark = "#23262c";
  // coronha retrátil + tubo
  box(g, at(0.12), by - 1.6, at(0.26) - at(0.12), 3.2, dark, 1.2);
  poly(g, [
    [at(-0.07), by - 3.5],
    [at(0.13), by - 3],
    [at(0.13), by + 5.5],
    [at(-0.07), by + 7.5],
  ], dark);
  g.fillStyle = "rgba(255,255,255,0.1)";
  g.fillRect(at(-0.05), by - 2.4, at(0.1) - at(-0.05), 1);
  // punho
  poly(g, [
    [at(0.07), by + 3.5],
    [at(0.16), by + 3.5],
    [at(0.14), by + 13],
    [at(0.05), by + 12],
  ], dark);
  // carregador STANAG (levemente curvo)
  if (!o.magOut) {
    poly(g, [
      [at(0.27), by + 4],
      [at(0.37), by + 4],
      [at(0.39), by + 16],
      [at(0.3), by + 17],
    ], "#2a2c31");
    ticks(g, at(0.29), at(0.35), by + 7, by + 15, 2.2, "rgba(255,255,255,0.12)");
  }
  // receptor (upper/lower)
  box(g, at(0.14), by - 3.8, at(0.5) - at(0.14), 8, metal, 1.4);
  g.fillStyle = "#1b1d22";
  g.fillRect(at(0.3), by - 2, at(0.4) - at(0.3), 2); // janela de ejeção
  shine(g, at(0.16), at(0.48), by - 2.6);
  // guarda-mão com trilhos
  box(g, at(0.5), by - 3.4, at(0.8) - at(0.5), 6.8, "#2c2f36", 1.2);
  g.fillStyle = "#15171b";
  for (let i = 0; i < 4; i++) g.fillRect(at(0.53 + i * 0.065), by - 0.8, at(0.035) - at(0), 1.8);
  // trilho de cima (picatinny) + mira traseira
  box(g, at(0.18), by - 5.6, at(0.78) - at(0.18), 2, "#1d2025", 0.6, 1);
  ticks(g, at(0.2), at(0.76), by - 5.4, by - 3.8, 2.6, "rgba(255,255,255,0.14)");
  // mira red-dot (como o sprite antigo) + reflexo vermelho
  box(g, at(0.3), by - 9.6, at(0.42) - at(0.3), 4.2, "#1a1c20", 1.4, 1);
  box(g, at(0.32), by - 5.8, at(0.4) - at(0.32), 1.2, "#1a1c20", 0.4, 0.8);
  g.fillStyle = "rgba(255,70,50,0.95)";
  g.fillRect(at(0.405), by - 8.8, 1, 2.6);
  g.fillStyle = "rgba(255,170,150,0.55)";
  g.fillRect(at(0.405), by - 8.8, 1, 0.9);
  pin(g, at(0.2), by + 1.5);
  pin(g, at(0.44), by + 1.5);
  // cano + massa de mira + quebra-chamas
  box(g, at(0.8), by - 1.3, bx - 4 - at(0.8), 2.6, "#1c1e22", 0.8, 1);
  poly(g, [
    [at(0.84), by - 1.4],
    [at(0.88), by - 1.4],
    [at(0.875), by - 7.5],
    [at(0.85), by - 7.5],
  ], dark, 1);
  box(g, bx - 4.5, by - 1.9, 4.5, 3.8, "#16181b", 0.8, 1);
  ticks(g, bx - 3.5, bx - 1, by - 1.7, by + 1.7, 1.2, "rgba(255,255,255,0.18)");
  muzzleHole(g, bx, by, 1.3);
}

/* ---------------- M16 (coronha fixa, alça de transporte) ---------------- */
function drawM16(g: CanvasRenderingContext2D, at: (u: number) => number, bx: number, by: number, o: GunArtOpts) {
  const body = "#383c35";
  const furn = "#262923";
  // coronha fixa longa
  poly(g, [
    [at(-0.1), by - 3.5],
    [at(0.15), by - 2.8],
    [at(0.15), by + 5],
    [at(-0.1), by + 8.5],
  ], furn);
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.fillRect(at(-0.08), by - 2.3, at(0.12) - at(-0.08), 1);
  // punho
  poly(g, [
    [at(0.07), by + 3.5],
    [at(0.16), by + 3.5],
    [at(0.14), by + 13],
    [at(0.05), by + 12],
  ], furn);
  if (!o.magOut) {
    poly(g, [
      [at(0.28), by + 4],
      [at(0.37), by + 4],
      [at(0.385), by + 15],
      [at(0.3), by + 15.6],
    ], "#2b2e29");
  }
  // receptor
  box(g, at(0.14), by - 3.6, at(0.48) - at(0.14), 7.6, body, 1.4);
  shine(g, at(0.16), at(0.46), by - 2.4);
  // alça de transporte (triângulo vazado)
  g.strokeStyle = OUT;
  g.lineWidth = 3.2;
  g.beginPath();
  g.moveTo(at(0.18), by - 3.6);
  g.lineTo(at(0.21), by - 8.5);
  g.lineTo(at(0.4), by - 8.5);
  g.lineTo(at(0.43), by - 3.6);
  g.stroke();
  g.strokeStyle = body;
  g.lineWidth = 1.6;
  g.stroke();
  // guarda-mão redondo (canelado)
  box(g, at(0.48), by - 3.2, at(0.76) - at(0.48), 6.4, furn, 2.6);
  ticks(g, at(0.51), at(0.73), by - 2.4, by + 2.4, 2.1, "rgba(255,255,255,0.13)");
  // cano, massa de mira triangular, quebra-chamas
  box(g, at(0.76), by - 1.2, bx - 4 - at(0.76), 2.4, "#1c1e1b", 0.8, 1);
  poly(g, [
    [at(0.8), by - 1.2],
    [at(0.87), by - 1.2],
    [at(0.845), by - 7.8],
  ], furn, 1);
  box(g, bx - 4.2, by - 1.7, 4.2, 3.4, "#161815", 0.8, 1);
  muzzleHole(g, bx, by, 1.2);
}

/* ---------------- AK-47 (madeira, pente banana) ---------------- */
function drawAK(g: CanvasRenderingContext2D, at: (u: number) => number, bx: number, by: number, o: GunArtOpts) {
  const wood = "#8a5528";
  const woodDark = "#5e3718";
  const metal = "#2f3034";
  // coronha de madeira
  poly(g, [
    [at(-0.09), by - 2.4],
    [at(0.15), by - 2],
    [at(0.15), by + 4.5],
    [at(-0.09), by + 9],
  ], wood);
  grain(g, at(-0.06), at(0.13), by + 0.4, "rgba(60,30,10,0.55)", 3, 2.3);
  g.fillStyle = "rgba(255,220,170,0.18)";
  g.fillRect(at(-0.07), by - 1.4, at(0.13) - at(-0.07), 0.9);
  // punho de madeira
  poly(g, [
    [at(0.08), by + 3.5],
    [at(0.16), by + 3.5],
    [at(0.15), by + 12.5],
    [at(0.07), by + 12],
  ], woodDark);
  // pente banana
  if (!o.magOut) {
    g.beginPath();
    g.moveTo(at(0.28), by + 4);
    g.lineTo(at(0.37), by + 4);
    g.quadraticCurveTo(at(0.4), by + 12, at(0.46), by + 17.5);
    g.lineTo(at(0.38), by + 19.5);
    g.quadraticCurveTo(at(0.31), by + 12, at(0.28), by + 4);
    g.closePath();
    g.fillStyle = "#33312d";
    g.fill();
    g.lineWidth = 1.2;
    g.strokeStyle = OUT;
    g.stroke();
    ticks(g, at(0.31), at(0.38), by + 8, by + 9, 2.4, "rgba(255,255,255,0.12)");
  }
  // receptor estampado
  box(g, at(0.14), by - 3.2, at(0.5) - at(0.14), 7, metal, 1.2);
  shine(g, at(0.16), at(0.48), by - 2.1, 0.28);
  // alavanca de segurança + ferrolho
  g.fillStyle = "#1a1b1e";
  g.fillRect(at(0.2), by - 0.4, at(0.3) - at(0.2), 1.3);
  g.fillRect(at(0.44), by - 4.2, 3, 2);
  // guarda-mão de madeira + tubo de gás
  box(g, at(0.5), by - 2.8, at(0.72) - at(0.5), 6, wood, 1.8);
  grain(g, at(0.52), at(0.7), by - 0.8, "rgba(60,30,10,0.55)", 2, 2.2);
  box(g, at(0.5), by - 5.3, at(0.78) - at(0.5), 2.5, "#25262a", 1, 1);
  pin(g, at(0.18), by + 1.8);
  pin(g, at(0.46), by + 1.8);
  // cano + massa de mira + freio de boca
  box(g, at(0.72), by - 1.1, bx - 3.6 - at(0.72), 2.2, "#1e1f22", 0.8, 1);
  poly(g, [
    [at(0.86), by - 1.2],
    [at(0.9), by - 1.2],
    [at(0.895), by - 6.5],
    [at(0.87), by - 6.5],
  ], metal, 1);
  poly(g, [
    [bx - 3.8, by - 1.5],
    [bx, by - 1.1],
    [bx, by + 1.1],
    [bx - 3.8, by + 1.5],
  ], "#18191c", 1);
  muzzleHole(g, bx, by, 1.1);
}

/* ---------------- escopeta pump ---------------- */
function drawShotgun(g: CanvasRenderingContext2D, at: (u: number) => number, bx: number, by: number) {
  const wood = "#7c4a24";
  const woodDark = "#55301a";
  const metal = "#393b41";
  // coronha
  poly(g, [
    [at(-0.1), by - 2.6],
    [at(0.2), by - 1.8],
    [at(0.2), by + 4.5],
    [at(-0.1), by + 9.5],
  ], wood);
  grain(g, at(-0.07), at(0.18), by + 0.6, "rgba(50,24,8,0.55)", 3, 2.4);
  g.fillStyle = "rgba(255,220,170,0.16)";
  g.fillRect(at(-0.08), by - 1.6, at(0.18) - at(-0.08), 0.9);
  // receptor + guarda-mato
  box(g, at(0.18), by - 3.2, at(0.42) - at(0.18), 6.8, metal, 1.4);
  shine(g, at(0.2), at(0.4), by - 2.1);
  g.strokeStyle = OUT;
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(at(0.22), by + 3.6);
  g.quadraticCurveTo(at(0.25), by + 8, at(0.31), by + 3.6);
  g.stroke();
  // tubo do carregador (embaixo) + cano (em cima)
  box(g, at(0.42), by + 0.8, at(0.95) - at(0.42), 3.2, "#2b2d32", 1.4, 1);
  box(g, at(0.42), by - 2, bx - at(0.42), 3.4, "#24262a", 1.2, 1);
  shine(g, at(0.44), bx - 1, by - 1.2, 0.3);
  // pump de madeira (canelado)
  box(g, at(0.52), by - 0.2, at(0.74) - at(0.52), 5.6, wood, 2.2);
  ticks(g, at(0.54), at(0.72), by + 0.8, by + 4.2, 1.8, "rgba(40,20,8,0.55)");
  // mira de conta
  g.fillStyle = "#d8d0b0";
  g.beginPath();
  g.arc(bx - 2.5, by - 2.6, 0.9, 0, Math.PI * 2);
  g.fill();
  muzzleHole(g, bx, by - 0.3, 1.5);
}

/* ---------------- SMG compacta (tipo Uzi: pente dentro do punho) ---------------- */
function drawSMG(g: CanvasRenderingContext2D, at: (u: number) => number, bx: number, by: number, o: GunArtOpts) {
  const metal = "#3a3c46";
  const dark = "#23252c";
  // coronha dobrada (arame) por baixo
  g.strokeStyle = OUT;
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(at(0.3), by + 3.8);
  g.lineTo(at(-0.08), by + 3.8);
  g.lineTo(at(-0.08), by - 1.5);
  g.lineTo(at(0.1), by - 1.5);
  g.stroke();
  g.strokeStyle = "#50535e";
  g.lineWidth = 1;
  g.stroke();
  // pente comprido saindo do punho (como o sprite antigo)
  if (!o.magOut) {
    box(g, at(0.06), by + 11, at(0.2) - at(0.06), 9, "#1c1d22", 1, 1.1);
    g.fillStyle = "rgba(255,255,255,0.14)";
    g.fillRect(at(0.08), by + 12, 1, 7);
  }
  // punho (o pente mora aqui dentro)
  poly(g, [
    [at(0.04), by + 3.5],
    [at(0.22), by + 3.5],
    [at(0.21), by + 12],
    [at(0.05), by + 12],
  ], dark);
  g.fillStyle = "rgba(255,255,255,0.08)";
  for (let i = 0; i < 3; i++) g.fillRect(at(0.07), by + 5.5 + i * 2.2, at(0.19) - at(0.07), 0.8);
  // guarda-mato
  g.strokeStyle = OUT;
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(at(0.22), by + 4);
  g.quadraticCurveTo(at(0.28), by + 9, at(0.36), by + 4);
  g.stroke();
  // receptor caixote
  box(g, at(0.02), by - 4.2, at(0.78) - at(0.02), 8.6, metal, 1.6);
  // tampa superior com canaleta + alça de manejo
  box(g, at(0.06), by - 6.2, at(0.72) - at(0.06), 2.4, dark, 0.8, 1);
  g.fillStyle = OUT;
  g.fillRect(at(0.5), by - 8.4, 2.2, 2.4);
  // miras
  g.fillRect(at(0.08), by - 8.2, 2, 2);
  g.fillRect(at(0.7), by - 8.6, 1.6, 2.4);
  // furos de refrigeração na frente
  g.fillStyle = "#15161a";
  for (let i = 0; i < 3; i++) g.fillRect(at(0.56 + i * 0.06), by - 1, 1.6, 1.8);
  pin(g, at(0.14), by + 1.6);
  pin(g, at(0.44), by + 1.6);
  // cano curto
  box(g, at(0.78), by - 1.4, bx - at(0.78), 2.8, "#1a1c20", 0.8, 1);
  muzzleHole(g, bx, by, 1.2);
}

/* ---------------- sniper (ferrolho + luneta) ---------------- */
function drawSniper(g: CanvasRenderingContext2D, at: (u: number) => number, bx: number, by: number, o: GunArtOpts) {
  const stock = "#4f5b3b";
  const stockDark = "#37402a";
  const metal = "#23262a";
  // coronha com apoio de rosto
  poly(g, [
    [at(-0.08), by - 3],
    [at(0.06), by - 4.5],
    [at(0.18), by - 2.2],
    [at(0.2), by + 4.2],
    [at(0.08), by + 5],
    [at(-0.08), by + 8.8],
  ], stock);
  g.fillStyle = stockDark;
  g.fillRect(at(-0.08), by + 5.8, at(0.02) - at(-0.08), 2.4);
  // punho (empunhadura de polegar)
  poly(g, [
    [at(0.1), by + 3.8],
    [at(0.18), by + 3.8],
    [at(0.16), by + 11.5],
    [at(0.09), by + 11],
  ], stockDark);
  // corpo da coronha até o meio do cano
  box(g, at(0.18), by - 2.6, at(0.64) - at(0.18), 6.4, stock, 2);
  shine(g, at(0.2), at(0.62), by - 1.6, 0.25);
  // carregador pequeno
  if (!o.magOut) box(g, at(0.34), by + 3.6, at(0.42) - at(0.34), 5, "#1f2226", 1);
  // ação + ferrolho
  box(g, at(0.18), by - 3.4, at(0.44) - at(0.18), 3, metal, 1, 1);
  g.strokeStyle = OUT;
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(at(0.3), by - 0.5);
  g.lineTo(at(0.28), by + 4.5);
  g.stroke();
  g.fillStyle = "#101214";
  g.beginPath();
  g.arc(at(0.28), by + 5, 1.5, 0, Math.PI * 2);
  g.fill();
  // cano longo
  box(g, at(0.62), by - 1.1, bx - at(0.62), 2.2, metal, 0.8, 1);
  box(g, bx - 4.5, by - 1.7, 4.5, 3.4, "#15171a", 0.8, 1); // freio
  // luneta
  box(g, at(0.24), by - 9.5, at(0.58) - at(0.24), 4.4, "#1b1e22", 2.2);
  poly(g, [
    [at(0.2), by - 10.2],
    [at(0.25), by - 9.9],
    [at(0.25), by - 4.8],
    [at(0.2), by - 4.5],
  ], "#16181c", 1);
  poly(g, [
    [at(0.57), by - 9.9],
    [at(0.63), by - 10.6],
    [at(0.63), by - 4],
    [at(0.57), by - 4.8],
  ], "#16181c", 1);
  g.fillStyle = "#1b1e22";
  g.fillRect(at(0.3), by - 5.2, 2, 2);
  g.fillRect(at(0.5), by - 5.2, 2, 2);
  // lente (reflexo azul que passeia)
  const t = o.t ?? 0;
  const lx = at(0.635);
  const glow = 0.55 + 0.3 * Math.sin(t * 0.004);
  const lens = g.createLinearGradient(lx, by - 10, lx, by - 4);
  lens.addColorStop(0, `rgba(120,200,255,${glow})`);
  lens.addColorStop(1, "rgba(30,80,140,0.9)");
  g.fillStyle = lens;
  g.beginPath();
  g.ellipse(lx, by - 7.3, 1.1, 3, 0, 0, Math.PI * 2);
  g.fill();
  shine(g, at(0.27), at(0.55), by - 8.6, 0.3);
  muzzleHole(g, bx, by, 1.1);
}

/** Mãos na arma (pele + contorno), por cima do desenho. */
export function drawGunHands(g: CanvasRenderingContext2D, weaponId: number, skin: string) {
  const h = gunHandPoints(weaponId);
  const hand = (x: number, y: number, rx: number, ry: number, rot: number) => {
    g.beginPath();
    g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    g.fillStyle = skin;
    g.fill();
    g.strokeStyle = OUT;
    g.lineWidth = 1.2;
    g.stroke();
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.beginPath();
    g.ellipse(x, y + ry * 0.35, rx * 0.8, ry * 0.5, rot, 0, Math.PI * 2);
    g.fill();
  };
  hand(h.rear[0], h.rear[1], 3.8, 3.1, 0.15);
  hand(h.front[0], h.front[1], 3.9, 3.1, -0.1);
}

/** Arma inteira num retângulo (drops no chão / ícones). */
export function drawGunIcon(g: CanvasRenderingContext2D, weaponId: number, cx: number, cy: number, width: number, t = 0) {
  const G = gunGeom(weaponId);
  const L = G.len + 6;
  const s = width / L;
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.translate(-(G.x0 + G.tipX) / 2, -(G.tipY + 5));
  drawGunArt(g, weaponId, { t });
  g.restore();
}
