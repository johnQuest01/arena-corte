/** Constantes compartilhadas â€” cliente e servidor. */
import { MAP_SPAWNS } from "./map";
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
/** Deve bater com MAP_W×TILE / MAP_H×TILE em map.ts (80×56×32). */
export const ARENA_W = 2560;
export const ARENA_H = 1792;
/** Janela visível da câmera (mundo), não o mapa inteiro. */
export const CAM_VIEW_W = 960;
export const CAM_VIEW_H = 640;
export const PLAYER_R = 14;
/**
 * Raio de ACERTO (balas/melee) — alinhado ao tamanho visual do personagem
 * (sprite ~112px). PLAYER_R fica menor só pra portas/paredes.
 */
export const PLAYER_HIT_R = 48;
/** Centro do torso acima do pivot (pés) — onde a figura é desenhada. */
export const PLAYER_HIT_Y = -30;
export const BULLET_SPEED = 520;
export const BULLET_R = 3;
export const MOVE_SPEED = 210;
export const FIRE_COOLDOWN_MS = 220;
export const MAX_HP = 100;
export const BULLET_DAMAGE = 25;
export const USE_ROLLBACK = false;
export const PREMIUM_ROUTING = "off" as const;
export const PLAYER_COLORS = ["#E8A838", "#5BB8E8", "#C45C5C"] as const;
/** @deprecated â€” colisÃ£o vem de shared/map.ts */
export const OBSTACLES: { x: number; y: number; w: number; h: number; kind?: string }[] = [];
export const STREET_LAMPS: { x: number; y: number }[] = [
  { x: 160, y: 280 },
  { x: 2400, y: 280 },
  { x: 160, y: 1500 },
  { x: 2400, y: 1500 },
  { x: 1280, y: 140 },
  { x: 1280, y: 1650 },
  { x: 700, y: 900 },
  { x: 1860, y: 900 },
];
export const SPAWNS = MAP_SPAWNS;
export const DOOR_AUTO_CLOSE_MS = 4000;
export const DOOR_USE_RADIUS = 28;
