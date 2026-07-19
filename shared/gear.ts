/** Armas, throwables, loadouts visuais e stamina. */

export type WeaponId = 0 | 1 | 2 | 3; // pistol, m4a1, m16, ak47
export type ThrowId = 0 | 1 | 2 | 3 | 4; // none, grenade, flash, smoke, molotov

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** comprimento visual (px top-down) */
  length: number;
  width: number;
  color: string;
  accent: string;
  damage: number;
  bulletSpeed: number;
  cooldownMs: number;
  spread: number; // radianos
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 0,
    name: "Pistola",
    length: 16,
    width: 4,
    color: "#2a2a2e",
    accent: "#6b6b70",
    damage: 22,
    bulletSpeed: 480,
    cooldownMs: 280,
    spread: 0.04,
  },
  {
    id: 1,
    name: "M4A1",
    length: 28,
    width: 5,
    color: "#3d4450",
    accent: "#1a1a1a",
    damage: 18,
    bulletSpeed: 620,
    cooldownMs: 100,
    spread: 0.03,
  },
  {
    id: 2,
    name: "M16",
    length: 30,
    width: 5,
    color: "#4a5a3a",
    accent: "#2a2a20",
    damage: 20,
    bulletSpeed: 640,
    cooldownMs: 110,
    spread: 0.025,
  },
  {
    id: 3,
    name: "AK-47",
    length: 29,
    width: 6,
    color: "#5c4030",
    accent: "#2b2b2b",
    damage: 26,
    bulletSpeed: 560,
    cooldownMs: 120,
    spread: 0.05,
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
export const STAMINA_DRAIN_PER_S = 28; // correndo
export const STAMINA_REGEN_PER_S = 18;
export const SPRINT_MULT = 1.4;
export const TIRED_MULT = 0.72; // stamina baixa
export const TIRED_THRESHOLD = 12;

/** Aparência por slot de jogador (roupa / cabelo). */
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
