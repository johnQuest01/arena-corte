/** Armas, throwables, loadouts visuais e stamina. */

export type WeaponId = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type ThrowId = 0 | 1 | 2 | 3 | 4;

export interface WeaponDef {
  id: WeaponId;
  name: string;
  length: number;
  width: number;
  color: string;
  accent: string;
  damage: number;
  bulletSpeed: number;
  cooldownMs: number;
  spread: number;
  muzzleForward: number;
  muzzleSide: number;
  pellets: number;
  bulletLifeMs: number;
  magSize: number;
  reserveMax: number;
  reloadMs: number;
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 0,
    name: "Pistola",
    length: 28,
    width: 7,
    color: "#2a2a2e",
    accent: "#6b6b70",
    damage: 22,
    bulletSpeed: 480,
    cooldownMs: 280,
    spread: 0.04,
    muzzleForward: 42,
    muzzleSide: 8,
    pellets: 1,
    bulletLifeMs: 0,
    magSize: 12,
    reserveMax: 60,
    reloadMs: 900,
  },
  {
    id: 1,
    name: "M4A1",
    length: 52,
    width: 9,
    color: "#3d4450",
    accent: "#1a1a1a",
    damage: 18,
    bulletSpeed: 620,
    cooldownMs: 100,
    spread: 0.03,
    muzzleForward: 62,
    muzzleSide: 8,
    pellets: 1,
    bulletLifeMs: 0,
    magSize: 30,
    reserveMax: 90,
    reloadMs: 1600,
  },
  {
    id: 2,
    name: "M16",
    length: 54,
    width: 9,
    color: "#4a5a3a",
    accent: "#2a2a20",
    damage: 20,
    bulletSpeed: 640,
    cooldownMs: 110,
    spread: 0.025,
    muzzleForward: 64,
    muzzleSide: 8,
    pellets: 1,
    bulletLifeMs: 0,
    magSize: 30,
    reserveMax: 90,
    reloadMs: 1700,
  },
  {
    id: 3,
    name: "AK-47",
    length: 52,
    width: 10,
    color: "#5c4030",
    accent: "#2b2b2b",
    damage: 26,
    bulletSpeed: 560,
    cooldownMs: 120,
    spread: 0.05,
    muzzleForward: 62,
    muzzleSide: 8,
    pellets: 1,
    bulletLifeMs: 0,
    magSize: 35,
    reserveMax: 120,
    reloadMs: 1800,
  },
  {
    id: 4,
    name: "Shotgun",
    length: 50,
    width: 10,
    color: "#4a3a28",
    accent: "#8a7040",
    damage: 9,
    bulletSpeed: 420,
    cooldownMs: 700,
    spread: 0.22,
    muzzleForward: 60,
    muzzleSide: 8,
    pellets: 6,
    bulletLifeMs: 280,
    magSize: 6,
    reserveMax: 30,
    reloadMs: 2200,
  },
  {
    id: 5,
    name: "SMG",
    length: 36,
    width: 9,
    color: "#3a3a48",
    accent: "#6a6a78",
    damage: 12,
    bulletSpeed: 540,
    cooldownMs: 60,
    spread: 0.07,
    muzzleForward: 50,
    muzzleSide: 8,
    pellets: 1,
    bulletLifeMs: 0,
    magSize: 40,
    reserveMax: 160,
    reloadMs: 1400,
  },
  {
    id: 6,
    name: "Sniper",
    length: 62,
    width: 8,
    color: "#2a3028",
    accent: "#1a2018",
    damage: 70,
    bulletSpeed: 900,
    cooldownMs: 1100,
    spread: 0.004,
    muzzleForward: 74,
    muzzleSide: 7,
    pellets: 1,
    bulletLifeMs: 0,
    magSize: 5,
    reserveMax: 25,
    reloadMs: 2400,
  },
];

export interface ThrowDef {
  id: ThrowId;
  name: string;
  fuseMs: number;
  throwSpeed: number;
  radius: number;
  color: string;
}

export const THROWS: Record<Exclude<ThrowId, 0>, ThrowDef> = {
  1: { id: 1, name: "Granada", fuseMs: 1800, throwSpeed: 280, radius: 70, color: "#3a5a30" },
  2: { id: 2, name: "Flash", fuseMs: 1400, throwSpeed: 300, radius: 110, color: "#e8e0a0" },
  3: { id: 3, name: "Fumaça", fuseMs: 1200, throwSpeed: 260, radius: 90, color: "#888880" },
  4: { id: 4, name: "Molotov", fuseMs: 900, throwSpeed: 240, radius: 55, color: "#c45c20" },
};

export const MAX_STAMINA = 100;
export const STAMINA_DRAIN_PER_S = 28;
export const STAMINA_REGEN_PER_S = 18;
export const SPRINT_MULT = 1.4;
export const TIRED_MULT = 0.72;
export const TIRED_THRESHOLD = 12;

export const WEAPON_SFX = [
  "pistol",
  "m4a1",
  "m16",
  "ak47",
  "shotgun",
  "smg",
  "sniper",
] as const;

export interface LoadoutLook {
  hair: string;
  skin: string;
  shirt: string;
  pants: string;
  shoes: string;
}

export const LOADOUTS: LoadoutLook[] = [
  { hair: "#1a120c", skin: "#d4a574", shirt: "#2F5FD0", pants: "#1F4A3D", shoes: "#222" },
  { hair: "#3b2814", skin: "#c68642", shirt: "#E8A838", pants: "#2a3540", shoes: "#1a1a1a" },
  { hair: "#0d0d0d", skin: "#e0b090", shirt: "#C45C5C", pants: "#3a3a48", shoes: "#2a2018" },
];

export function weaponOf(id: number): WeaponDef {
  return WEAPONS[id as WeaponId] ?? WEAPONS[0]!;
}

export function muzzlePoint(
  x: number,
  y: number,
  angle: number,
  wpn: WeaponDef,
): { x: number; y: number } {
  return {
    x: x + Math.cos(angle) * wpn.muzzleForward - Math.sin(angle) * wpn.muzzleSide,
    y: y + Math.sin(angle) * wpn.muzzleForward + Math.cos(angle) * wpn.muzzleSide,
  };
}

export function fillAmmo(weapon: number): { mag: number; reserve: number } {
  const w = weaponOf(weapon);
  return { mag: w.magSize, reserve: w.reserveMax };
}
