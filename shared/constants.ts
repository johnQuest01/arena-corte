/** Constantes compartilhadas â€” cliente e servidor. */
import { MAP_SPAWNS } from "./map";
export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;
export const INPUT_HZ = 60;
export const INPUT_DT = 1 / INPUT_HZ;
/** Capacidade do sim (treino: 1 humano + 6 bots). */
export const MAX_PLAYERS = 7;
/** Cap da sala online — não abrir lobby para 7 humanos. */
export const ONLINE_ROOM_CAP = 3;
export const INTERP_DELAY_MS = 100;
export const SMOOTH_MS = 120;
export const RESPAWN_MS = 3000;
export const MATCH_MS = 5 * 60 * 1000;
export const KILL_LIMIT = 15;
/** Deve bater com MAP_W×TILE / MAP_H×TILE em map.ts (160×120×32). */
export const ARENA_W = 5120;
export const ARENA_H = 3840;
/** Janela visível da câmera (mundo), não o mapa inteiro. */
export const CAM_VIEW_W = 1920;
export const CAM_VIEW_H = 1280;
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
export const PLAYER_COLORS = [
  "#E8A838",
  "#5BB8E8",
  "#C45C5C",
  "#7BC47F",
  "#C9A0DC",
  "#E07A5F",
  "#81B29A",
] as const;
/** @deprecated â€” colisÃ£o vem de shared/map.ts */
export const OBSTACLES: { x: number; y: number; w: number; h: number; kind?: string }[] = [];
/** Postes nas cruzamentos da malha urbana (PITCH=20, ROAD_W=4). */
export const STREET_LAMPS: { x: number; y: number }[] = [
  { x: 2 * 32, y: 2 * 32 },
  { x: 42 * 32, y: 2 * 32 },
  { x: 82 * 32, y: 2 * 32 },
  { x: 122 * 32, y: 2 * 32 },
  { x: 2 * 32, y: 42 * 32 },
  { x: 42 * 32, y: 42 * 32 },
  { x: 82 * 32, y: 42 * 32 },
  { x: 122 * 32, y: 42 * 32 },
  { x: 2 * 32, y: 82 * 32 },
  { x: 42 * 32, y: 82 * 32 },
  { x: 82 * 32, y: 82 * 32 },
  { x: 122 * 32, y: 82 * 32 },
  { x: 22 * 32, y: 22 * 32 },
  { x: 62 * 32, y: 62 * 32 },
  { x: 102 * 32, y: 102 * 32 },
  { x: 142 * 32, y: 22 * 32 },
];
export const SPAWNS = MAP_SPAWNS;
export const DOOR_AUTO_CLOSE_MS = 4000;
export const DOOR_USE_RADIUS = 28;
