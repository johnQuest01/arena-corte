/**
 * map.ts — cidade pós-apocalíptica (ruas, calçadas, quarteirões, prédios).
 * Grade 160×120 × 32px = 5120×3840. Sem import de constants (evita ciclo).
 */

export const TILE = 32;
export const MAP_W = 160;
export const MAP_H = 120;
const ARENA_W = MAP_W * TILE;
const ARENA_H = MAP_H * TILE;

/** Flag client-side: máscara de visão (raycast). Default off. */
export const USE_VISION = false;

export const T = {
  SAND: 0,
  DIRT: 1,
  WOOD: 2,
  CONCRETE: 3,
  ROAD: 4,
  ROAD_LINE: 5,
  SIDEWALK: 6,
  GRASS: 7,
  GRASS_TALL: 8,
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

function wallRing(
  g: number[][],
  tx: number,
  ty: number,
  tw: number,
  th: number,
  tile: number = T.WALL,
) {
  fillRect(g, tx, ty, tw, 1, tile);
  fillRect(g, tx, ty + th - 1, tw, 1, tile);
  fillRect(g, tx, ty, 1, th, tile);
  fillRect(g, tx + tw - 1, ty, 1, th, tile);
}

/** Hash determinístico 0..n-1 */
function hxy(x: number, y: number, n: number): number {
  let h = (x * 73856093) ^ (y * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return h % n;
}

const PITCH = 20;
const ROAD_W = 4;

function isRoadX(x: number): boolean {
  return x % PITCH < ROAD_W;
}
function isRoadY(y: number): boolean {
  return y % PITCH < ROAD_W;
}

function buildCity(): {
  ground: number[][];
  solid: number[][];
  buildings: BuildingDef[];
  doors: DoorDef[];
} {
  const ground: number[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    const row: number[] = [];
    for (let x = 0; x < MAP_W; x++) {
      // base: mato ressecado / terra
      row.push(hxy(x, y, 9) === 0 ? T.DIRT : T.GRASS);
    }
    ground.push(row);
  }

  const solid: number[][] = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(0));
  const buildings: BuildingDef[] = [];
  const doors: DoorDef[] = [];

  // —— malha de ruas + calçadas + faixas ——
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const vr = isRoadX(x);
      const hr = isRoadY(y);
      if (vr || hr) {
        const mx = x % PITCH;
        const my = y % PITCH;
        // faixa central desbotada
        if ((vr && !hr && (mx === 1 || mx === 2)) || (hr && !vr && (my === 1 || my === 2))) {
          ground[y]![x] = T.ROAD_LINE;
        } else {
          ground[y]![x] = T.ROAD;
        }
        continue;
      }
      // calçada: 1–2 tiles na borda do quarteirão (lado da rua)
      const bx = x % PITCH;
      const by = y % PITCH;
      if (
        bx === ROAD_W ||
        bx === ROAD_W + 1 ||
        bx === PITCH - 1 ||
        bx === PITCH - 2 ||
        by === ROAD_W ||
        by === ROAD_W + 1 ||
        by === PITCH - 1 ||
        by === PITCH - 2
      ) {
        ground[y]![x] = T.SIDEWALK;
      } else if (hxy(x, y, 11) < 3) {
        ground[y]![x] = T.GRASS_TALL;
      } else if (hxy(x + 3, y + 7, 7) === 0) {
        ground[y]![x] = T.CONCRETE;
      }
    }
  }

  // cruzamentos: asfalto limpo (sem faixa) — legibilidade
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (isRoadX(x) && isRoadY(y)) ground[y]![x] = T.ROAD;
    }
  }

  // praças abertas (combate) — limpa mato alto / concreto denso
  const plazas: { tx: number; ty: number; tw: number; th: number }[] = [
    { tx: 44, ty: 44, tw: 12, th: 12 },
    { tx: 104, ty: 24, tw: 14, th: 10 },
    { tx: 24, ty: 84, tw: 12, th: 12 },
    { tx: 84, ty: 84, tw: 16, th: 10 },
  ];
  for (const p of plazas) {
    fillRect(ground, p.tx, p.ty, p.tw, p.th, T.CONCRETE);
    // mato nas bordas da praça
    for (let i = 0; i < p.tw; i++) {
      if (hxy(p.tx + i, p.ty, 3) === 0) ground[p.ty]![p.tx + i] = T.GRASS;
      if (hxy(p.tx + i, p.ty + p.th - 1, 3) === 0) {
        ground[p.ty + p.th - 1]![p.tx + i] = T.GRASS_TALL;
      }
    }
  }

  function overlapsSolid(ox: number, oy: number, tw: number, th: number): boolean {
    for (let y = oy; y < oy + th; y++) {
      for (let x = ox; x < ox + tw; x++) {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return true;
        if (solid[y]![x]! >= 10) return true;
        // não construir em cima de rua
        if (isRoadX(x) || isRoadY(y)) return true;
      }
    }
    return false;
  }

  function inPlaza(ox: number, oy: number, tw: number, th: number): boolean {
    for (const p of plazas) {
      if (ox < p.tx + p.tw && ox + tw > p.tx && oy < p.ty + p.th && oy + th > p.ty) {
        return true;
      }
    }
    return false;
  }

  function placeBuilding(
    ox: number,
    oy: number,
    tw: number,
    th: number,
    wallTile: number,
    doorDir: "n" | "s" | "e" | "w",
  ): boolean {
    if (doors.length >= 16) return false;
    if (tw < 5 || th < 5) return false;
    if (overlapsSolid(ox, oy, tw, th)) return false;
    if (inPlaza(ox, oy, tw, th)) return false;

    wallRing(solid, ox, oy, tw, th, wallTile);
    fillRect(solid, ox + 1, oy + 1, tw - 2, th - 2, 0);
    fillRect(
      ground,
      ox + 1,
      oy + 1,
      tw - 2,
      th - 2,
      wallTile === T.METAL ? T.CONCRETE : T.WOOD,
    );

    let dtx = ox + Math.floor(tw / 2);
    let dty = oy + Math.floor(th / 2);
    let orient: "h" | "v" = "h";
    if (doorDir === "n") {
      dtx = ox + Math.floor(tw / 2);
      dty = oy;
      orient = "h";
    } else if (doorDir === "s") {
      dtx = ox + Math.floor(tw / 2);
      dty = oy + th - 1;
      orient = "h";
    } else if (doorDir === "w") {
      dtx = ox;
      dty = oy + Math.floor(th / 2);
      orient = "v";
    } else {
      dtx = ox + tw - 1;
      dty = oy + Math.floor(th / 2);
      orient = "v";
    }
    solid[dty]![dtx] = 0;

    const id = buildings.length;
    buildings.push({
      id,
      interior: { tx: ox + 1, ty: oy + 1, tw: tw - 2, th: th - 2 },
    });
    doors.push({ id, tx: dtx, ty: dty, orient });
    return true;
  }

  // —— prédios por quarteirão (máx 16 portas) ——
  const doorDirs: ("n" | "s" | "e" | "w")[] = ["s", "e", "n", "w"];
  let bi = 0;
  for (let by = 0; by < MAP_H; by += PITCH) {
    for (let bx = 0; bx < MAP_W; bx += PITCH) {
      // interior do quarteirão (depois da rua + calçada)
      const ix = bx + ROAD_W + 1;
      const iy = by + ROAD_W + 1;
      const iw = PITCH - ROAD_W - 2;
      const ih = PITCH - ROAD_W - 2;
      if (iw < 8 || ih < 8) continue;
      if (inPlaza(ix, iy, iw, ih)) continue;

      const roll = hxy(bx, by, 10);
      // ~70% dos quarteirões ganham prédio
      if (roll < 3) continue;

      const tw = 5 + hxy(bx + 1, by, 3); // 5..7
      const th = 5 + hxy(bx, by + 1, 3);
      const ox = ix + 1 + hxy(bx + 2, by, Math.max(1, iw - tw - 1));
      const oy = iy + 1 + hxy(bx, by + 2, Math.max(1, ih - th - 1));
      const wall = hxy(bx + 5, by + 5, 2) === 0 ? T.WALL : T.METAL;
      const dir = doorDirs[bi % doorDirs.length]!;
      if (placeBuilding(ox, oy, tw, th, wall, dir)) bi++;

      // segundo prédio menor em quarteirões grandes
      if (doors.length < 16 && iw > 12 && ih > 12 && hxy(bx + 9, by + 3, 5) < 2) {
        const tw2 = 5;
        const th2 = 5;
        const ox2 = ix + iw - tw2 - 1;
        const oy2 = iy + ih - th2 - 1;
        placeBuilding(ox2, oy2, tw2, th2, T.METAL, "n");
      }
    }
  }

  const isAsphalt = (t: number) => t === T.ROAD || t === T.ROAD_LINE;

  // —— cover: carros nas ruas, caixas/barris em calçadas ——
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      if (solid[y]![x]! >= 10) continue;
      const g = ground[y]![x]!;

      // carros abandonados no asfalto (2 tiles) — borda da faixa, fora do cruzamento
      const onVertRoad = isRoadX(x) && !isRoadY(y);
      const onHorzRoad = isRoadY(y) && !isRoadX(x);
      if (
        onVertRoad &&
        isAsphalt(g) &&
        isAsphalt(ground[y]![x + 1]!) &&
        solid[y]![x + 1]! < 10 &&
        isRoadX(x + 1) &&
        !isRoadY(y) &&
        hxy(x, y, 37) === 0
      ) {
        solid[y]![x] = T.CAR;
        solid[y]![x + 1] = T.CAR;
        continue;
      }
      if (
        onHorzRoad &&
        isAsphalt(g) &&
        isAsphalt(ground[y + 1]![x]!) &&
        solid[y + 1]![x]! < 10 &&
        isRoadY(y + 1) &&
        !isRoadX(x) &&
        hxy(x + 11, y, 41) === 0
      ) {
        solid[y]![x] = T.CAR;
        solid[y + 1]![x] = T.CAR;
        continue;
      }

      // entulho na calçada
      if (g === T.SIDEWALK && hxy(x, y, 29) === 0) {
        solid[y]![x] = hxy(x + 1, y, 2) === 0 ? T.CRATE : T.BARREL;
      }
      // caixas em baldios
      if ((g === T.GRASS || g === T.GRASS_TALL) && hxy(x, y, 61) === 0) {
        solid[y]![x] = T.CRATE;
      }
    }
  }

  // muro de borda da cidade (contém o mapa)
  fillRect(solid, 0, 0, MAP_W, 1, T.WALL);
  fillRect(solid, 0, MAP_H - 1, MAP_W, 1, T.WALL);
  fillRect(solid, 0, 0, 1, MAP_H, T.WALL);
  fillRect(solid, MAP_W - 1, 0, 1, MAP_H, T.WALL);

  return { ground, solid, buildings, doors };
}

const CITY = buildCity();
export const GROUND = CITY.ground;
export const SOLID = CITY.solid;
export const BUILDINGS: BuildingDef[] = CITY.buildings;
export const DOOR_DEFS: DoorDef[] = CITY.doors;

/** Spawns no centro das ruas / praças (treino 7 slots + online 3). */
export const MAP_SPAWNS: { x: number; y: number }[] = [
  { x: 2 * TILE + 16, y: 2 * TILE + 16 },
  { x: 42 * TILE + 16, y: 2 * TILE + 16 },
  { x: 82 * TILE + 16, y: 2 * TILE + 16 },
  { x: 122 * TILE + 16, y: 2 * TILE + 16 },
  { x: 2 * TILE + 16, y: 62 * TILE + 16 },
  { x: 62 * TILE + 16, y: 62 * TILE + 16 },
  { x: 122 * TILE + 16, y: 62 * TILE + 16 },
  { x: 2 * TILE + 16, y: 102 * TILE + 16 },
  { x: 82 * TILE + 16, y: 102 * TILE + 16 },
  { x: 50 * TILE, y: 50 * TILE }, // praça
  { x: 111 * TILE, y: 29 * TILE }, // praça
  { x: 90 * TILE, y: 89 * TILE }, // praça
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

  if (distSq > 1e-8) {
    if (distSq >= r * r) return { x: px, y: py, hit: false };
    const dist = Math.sqrt(distSq);
    const pen = r - dist;
    return { x: px + (dx / dist) * pen, y: py + (dy / dist) * pen, hit: true };
  }

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
  let nx = x;
  let ny = y;
  let ovx = vx;
  let ovy = vy;

  if (Math.abs(dx) > 1e-8) {
    const tryX = x + dx;
    const posX = resolveWalls(tryX, y, r, doorBits);
    if (Math.abs(posX.x - tryX) > 0.01) {
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
