/** Constantes compartilhadas — cliente e servidor. */

export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;
export const INPUT_HZ = 60;
export const INPUT_DT = 1 / INPUT_HZ;
export const MAX_PLAYERS = 3;
export const INTERP_DELAY_MS = 100;
export const SMOOTH_MS = 120;
export const RESPAWN_MS = 3000;
export const MATCH_MS = 5 * 60 * 1000;
export const KILL_LIMIT = 15;

export const ARENA_W = 960;
export const ARENA_H = 640;
export const PLAYER_R = 14;
export const BULLET_SPEED = 520;
export const BULLET_R = 3;
export const MOVE_SPEED = 210;
export const FIRE_COOLDOWN_MS = 220;
export const MAX_HP = 100;
export const BULLET_DAMAGE = 25;

export const USE_ROLLBACK = false;
export const PREMIUM_ROUTING = "off" as const;

export const PLAYER_COLORS = ["#E8A838", "#5BB8E8", "#C45C5C"] as const;

/** Obstáculos — rua: carros, caçambas, postes (AABB). */
export const OBSTACLES: { x: number; y: number; w: number; h: number; kind?: string }[] = [
  // carros estacionados
  { x: 120, y: 100, w: 70, h: 36, kind: "car" },
  { x: 760, y: 110, w: 70, h: 36, kind: "car" },
  { x: 140, y: 480, w: 70, h: 36, kind: "car" },
  { x: 740, y: 470, w: 70, h: 36, kind: "car" },
  // caçambas / containers
  { x: 420, y: 200, w: 50, h: 40, kind: "dumpster" },
  { x: 500, y: 380, w: 50, h: 40, kind: "dumpster" },
  // bancas / quiosque
  { x: 300, y: 300, w: 60, h: 50, kind: "kiosk" },
  { x: 600, y: 280, w: 55, h: 45, kind: "kiosk" },
];

/** Postes de luz (não colidem; só iluminação). */
export const STREET_LAMPS: { x: number; y: number }[] = [
  { x: 80, y: 200 },
  { x: 880, y: 200 },
  { x: 80, y: 440 },
  { x: 880, y: 440 },
  { x: 480, y: 80 },
  { x: 480, y: 560 },
];

export const SPAWNS: { x: number; y: number }[] = [
  { x: 80, y: 80 },
  { x: ARENA_W - 80, y: 80 },
  { x: ARENA_W / 2, y: ARENA_H - 80 },
];
