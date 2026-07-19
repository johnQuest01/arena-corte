/**
 * map.ts — tilemap deserto (Atomic Exile–inspired), colisão e portas.
 * Grade 80×56 × 32px = 2560×1792. Sem import de constants (evita ciclo).
 */

export const TILE = 32;
export const MAP_W = 80;
export const MAP_H = 56;
const ARENA_W = MAP_W * TILE;
const ARENA_H = MAP_H * TILE;

/** Flag client-side: máscara de visão (raycast). Default off. */
export const USE_VISION = false;

export const T = {
  SAND: 0,
  DIRT: 1,
  WOOD: 2,
  CONCRETE: 3,
  WALL: 10,
  METAL: 11,
  CRATE: 20,
  BARREL: 21,
  CAR: 22,
} as const;

export interface DoorDef {
  id: number;
  tx: number;
  ty: number;
  orient: "h" | "v";
}

export interface BuildingDef {
  id: number;
  interior: { tx: number; ty: number; tw: number; th: number };
}

export interface DoorState {
  id: number;
  x: number;
  y: number;
  orient: "h" | "v";
  open: boolean;
}

function fillRect(
  g: number[][],
  tx: number,
  ty: number,
  tw: number,
  th: number,
  tile: number,
) {
  for (let y = ty; y < ty + th; y++) {
    for (let x = tx; x < tx + tw; x++) {
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) g[y]![x] = tile;
    }
  }
}

function wallRing(g: number[][], tx: number, ty: number, tw: number, th: number, tile: number = T.WALL) {
  fillRect(g, tx, ty, tw, 1, tile);
  fillRect(g, tx, ty + th - 1, tw, 1, tile);
  fillRect(g, tx, ty, 1, th, tile);
  fillRect(g, tx + tw - 1, ty, 1, th, tile);
}

export const GROUND: number[][] = (() => {
  const g: number[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    const row: number[] = [];
    for (let x = 0; x < MAP_W; x++) {
      row.push((x + y) % 7 === 0 ? T.DIRT : T.SAND);
    }
    g.push(row);
  }
  // interiores nos cantos + centro — arena grande
  fillRect(g, 4, 4, 6, 5, T.WOOD);
  fillRect(g, 68, 3, 7, 6, T.CONCRETE);
  fillRect(g, 5, 46, 8, 5, T.WOOD);
  fillRect(g, 66, 45, 6, 5, T.CONCRETE);
  fillRect(g, 36, 24, 6, 4, T.CONCRETE);
  fillRect(g, 20, 18, 5, 4, T.WOOD);
  fillRect(g, 52, 30, 5, 4, T.CONCRETE);
  return g;
})();

export const SOLID: number[][] = (() => {
  const g: number[][] = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(0));

  // NW
  wallRing(g, 3, 3, 8, 7, T.WALL);
  fillRect(g, 4, 4, 6, 5, 0);
  g[9]![6] = 0;

  // NE
  wallRing(g, 67, 2, 9, 8, T.METAL);
  fillRect(g, 68, 3, 7, 6, 0);
  g[5]![67] = 0;

  // SW
  wallRing(g, 4, 45, 10, 7, T.WALL);
  fillRect(g, 5, 46, 8, 5, 0);
  g[45]![8] = 0;

  // SE
  wallRing(g, 65, 44, 8, 7, T.METAL);
  fillRect(g, 66, 45, 6, 5, 0);
  g[47]![65] = 0;

  // bunker central
  wallRing(g, 35, 23, 8, 6, T.WALL);
  fillRect(g, 36, 24, 6, 4, 0);
  g[28]![38] = 0;

  // hangares mid
  wallRing(g, 19, 17, 7, 6, T.WALL);
  fillRect(g, 20, 18, 5, 4, 0);
  g[22]![19] = 0;

  wallRing(g, 51, 29, 7, 6, T.METAL);
  fillRect(g, 52, 30, 5, 4, 0);
  g[31]![57] = 0;

  // props
  g[16]![28] = T.CRATE;
  g[16]![29] = T.CRATE;
  g[17]![28] = T.BARREL;
  g[14]![40] = T.CAR;
  g[14]![41] = T.CAR;
  g[30]![22] = T.CRATE;
  g[26]![50] = T.BARREL;
  g[38]![34] = T.CRATE;
  g[12]![55] = T.BARREL;
  g[42]![26] = T.CRATE;
  g[28]![62] = T.BARREL;
  g[20]![18] = T.CRATE;
  g[44]![48] = T.BARREL;

  return g;
})();

export const BUILDINGS: BuildingDef[] = [
  { id: 0, interior: { tx: 4, ty: 4, tw: 6, th: 5 } },
  { id: 1, interior: { tx: 68, ty: 3, tw: 7, th: 6 } },
  { id: 2, interior: { tx: 5, ty: 46, tw: 8, th: 5 } },
  { id: 3, interior: { tx: 66, ty: 45, tw: 6, th: 5 } },
  { id: 4, interior: { tx: 36, ty: 24, tw: 6, th: 4 } },
  { id: 5, interior: { tx: 20, ty: 18, tw: 5, th: 4 } },
  { id: 6, interior: { tx: 52, ty: 30, tw: 5, th: 4 } },
];

export const DOOR_DEFS: DoorDef[] = [
  { id: 0, tx: 6, ty: 9, orient: "h" },
  { id: 1, tx: 67, ty: 5, orient: "v" },
  { id: 2, tx: 8, ty: 45, orient: "h" },
  { id: 3, tx: 65, ty: 47, orient: "v" },
  { id: 4, tx: 38, ty: 28, orient: "h" },
  { id: 5, tx: 19, ty: 20, orient: "v" },
  { id: 6, tx: 57, ty: 31, orient: "v" },
];

export const MAP_SPAWNS: { x: number; y: number }[] = [
  { x: 160, y: ARENA_H / 2 },
  { x: ARENA_W - 160, y: ARENA_H / 2 },
  { x: ARENA_W / 2, y: ARENA_H - 160 },
];

export function isSolidTile(t: number): boolean {
  return t >= 10;
}

export function doorWorldRect(d: DoorDef): { x: number; y: number; w: number; h: number } {
  if (d.orient === "h") {
    return { x: d.tx * TILE, y: d.ty * TILE + 10, w: TILE, h: 12 };
  }
  return { x: d.tx * TILE + 10, y: d.ty * TILE, w: 12, h: TILE };
}

export function doorsBitfield(doors: { open: boolean }[]): number {
  let bits = 0;
  for (let i = 0; i < doors.length && i < 16; i++) {
    if (doors[i]?.open) bits |= 1 << i;
  }
  return bits;
}

export function doorsFromBits(bits: number): DoorState[] {
  return DOOR_DEFS.map((d) => {
    const r = doorWorldRect(d);
    return {
      id: d.id,
      x: r.x,
      y: r.y,
      orient: d.orient,
      open: !!(bits & (1 << d.id)),
    };
  });
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function circleRect(
  cx: number,
  cy: number,
  r: number,
  o: { x: number; y: number; w: number; h: number },
): boolean {
  const nx = clamp(cx, o.x, o.x + o.w);
  const ny = clamp(cy, o.y, o.y + o.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/**
 * Funde tiles sólidos em AABBs maiores (por linha, depois vertical).
 * Evita ping-pong entre tiles vizinhos que teleporta o player.
 */
function mergeSolidTiles(): { x: number; y: number; w: number; h: number }[] {
  const rowSpans: { tx: number; ty: number; tw: number }[] = [];
  for (let ty = 0; ty < MAP_H; ty++) {
    let start = -1;
    for (let tx = 0; tx <= MAP_W; tx++) {
      const solid = tx < MAP_W && isSolidTile(SOLID[ty]![tx]!);
      if (solid && start < 0) start = tx;
      if (!solid && start >= 0) {
        rowSpans.push({ tx: start, ty, tw: tx - start });
        start = -1;
      }
    }
  }

  // funde spans empilhados com mesmo tx/tw
  const used = new Array(rowSpans.length).fill(false);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < rowSpans.length; i++) {
    if (used[i]) continue;
    const a = rowSpans[i]!;
    let th = 1;
    used[i] = true;
    for (let j = i + 1; j < rowSpans.length; j++) {
      if (used[j]) continue;
      const b = rowSpans[j]!;
      if (b.tx === a.tx && b.tw === a.tw && b.ty === a.ty + th) {
        used[j] = true;
        th++;
      }
    }
    out.push({
      x: a.tx * TILE,
      y: a.ty * TILE,
      w: a.tw * TILE,
      h: th * TILE,
    });
  }
  return out;
}

const MERGED_SOLIDS = mergeSolidTiles();

export function solidRects(doorBits: number): { x: number; y: number; w: number; h: number }[] {
  const out = MERGED_SOLIDS.slice();
  for (const d of DOOR_DEFS) {
    if (doorBits & (1 << d.id)) continue;
    out.push(doorWorldRect(d));
  }
  return out;
}

/** Empurra o círculo para fora do AABB pelo vetor de menor penetração. */
function separateCircleRect(
  px: number,
  py: number,
  r: number,
  o: { x: number; y: number; w: number; h: number },
): { x: number; y: number; hit: boolean } {
  const nearestX = clamp(px, o.x, o.x + o.w);
  const nearestY = clamp(py, o.y, o.y + o.h);
  let dx = px - nearestX;
  let dy = py - nearestY;
  const distSq = dx * dx + dy * dy;

  // centro fora do retângulo
  if (distSq > 1e-8) {
    if (distSq >= r * r) return { x: px, y: py, hit: false };
    const dist = Math.sqrt(distSq);
    const pen = r - dist;
    return { x: px + (dx / dist) * pen, y: py + (dy / dist) * pen, hit: true };
  }

  // centro dentro — sai pelo eixo de menor penetração (não teleporta pelo tile)
  const penL = px - o.x + r;
  const penR = o.x + o.w - px + r;
  const penT = py - o.y + r;
  const penB = o.y + o.h - py + r;
  const m = Math.min(penL, penR, penT, penB);
  if (m === penL) return { x: o.x - r, y: py, hit: true };
  if (m === penR) return { x: o.x + o.w + r, y: py, hit: true };
  if (m === penT) return { x: px, y: o.y - r, hit: true };
  return { x: px, y: o.y + o.h + r, hit: true };
}

export function resolveWalls(
  x: number,
  y: number,
  r: number,
  doorBits = 0,
): { x: number; y: number } {
  let px = clamp(x, r, ARENA_W - r);
  let py = clamp(y, r, ARENA_H - r);
  const solids = solidRects(doorBits);

  // várias passadas: cantos / vários AABBs
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (const o of solids) {
      const next = separateCircleRect(px, py, r, o);
      if (!next.hit) continue;
      px = next.x;
      py = next.y;
      px = clamp(px, r, ARENA_W - r);
      py = clamp(py, r, ARENA_H - r);
      moved = true;
    }
    if (!moved) break;
  }
  return { x: px, y: py };
}

/**
 * Move com colisão em eixos separados (desliza na parede em vez de grudar)
 * e devolve a velocidade com componente “para dentro da parede” zerada.
 */
export function moveAndSlide(
  x: number,
  y: number,
  vx: number,
  vy: number,
  dt: number,
  r: number,
  doorBits = 0,
): { x: number; y: number; vx: number; vy: number } {
  const dx = vx * dt;
  const dy = vy * dt;
  // tenta X e Y separados → desliza em cantos/paredes
  let nx = x;
  let ny = y;
  let ovx = vx;
  let ovy = vy;

  if (Math.abs(dx) > 1e-8) {
    const tryX = x + dx;
    const posX = resolveWalls(tryX, y, r, doorBits);
    if (Math.abs(posX.x - tryX) > 0.01) {
      // bateu em X — cancela vx para dentro
      ovx = 0;
    }
    nx = posX.x;
  }

  if (Math.abs(dy) > 1e-8) {
    const tryY = ny + dy;
    const posY = resolveWalls(nx, tryY, r, doorBits);
    if (Math.abs(posY.y - tryY) > 0.01) {
      ovy = 0;
    }
    ny = posY.y;
    nx = posY.x;
  }

  // passada final (cantos / overlap residual)
  const end = resolveWalls(nx, ny, r, doorBits);
  return { x: end.x, y: end.y, vx: ovx, vy: ovy };
}

export function hitsSolid(x: number, y: number, r: number, doorBits: number): boolean {
  for (const o of solidRects(doorBits)) {
    if (circleRect(x, y, r, o)) return true;
  }
  return false;
}

export function buildingAt(wx: number, wy: number): number | null {
  const tx = Math.floor(wx / TILE);
  const ty = Math.floor(wy / TILE);
  for (const b of BUILDINGS) {
    const i = b.interior;
    if (tx >= i.tx && ty >= i.ty && tx < i.tx + i.tw && ty < i.ty + i.th) return b.id;
  }
  return null;
}

export function roofRect(b: BuildingDef): { x: number; y: number; w: number; h: number } {
  const i = b.interior;
  return {
    x: (i.tx - 1) * TILE,
    y: (i.ty - 1) * TILE,
    w: (i.tw + 2) * TILE,
    h: (i.th + 2) * TILE,
  };
}