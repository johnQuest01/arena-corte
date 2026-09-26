/**
 * cosmetics.ts — visual do personagem (só aparência, zero efeito no jogo).
 *
 * Viaja 1× no HELLO (11 bytes; clientes antigos mandam 9) e no LOBBY (JSON); nada por tick.
 * O cliente desenha tudo por código (character.ts); o host só guarda/repassa.
 */

export interface Look {
  /** 0 = boneco novo (código), 1 = "Rascunho" (sprite antigo + itens antigos) */
  body: number;
  skin: number;
  hair: number;
  hairColor: number;
  outfit: number;
  armor: number;
  boots: number;
  cape: number;
  helmet: number;
  /** 0 = armas desenhadas em código, 1 = "Rascunho" (sprites antigos) */
  gun: number;
  /** 0 = efeitos novos dos poderes, 1 = "Rascunho" (efeitos antigos) */
  fx: number;
}

export const LOOK_KEYS = [
  "body",
  "skin",
  "hair",
  "hairColor",
  "outfit",
  "armor",
  "boots",
  "cape",
  "helmet",
  "gun",
  "fx",
] as const;
/** Visual antigo (antes de gun/fx) — 9 bytes; o que faltar vira padrão. */
export const LOOK_MIN_BYTES = 9;
export type LookKey = (typeof LOOK_KEYS)[number];

export interface NamedItem {
  name: string;
}

export const BODIES: NamedItem[] = [{ name: "Novo" }, { name: "Rascunho (antigo)" }];
export const GUN_STYLES: NamedItem[] = [{ name: "Novas (código)" }, { name: "Rascunho (sprites antigos)" }];
export const FX_STYLES: NamedItem[] = [{ name: "Novos" }, { name: "Rascunho (efeitos antigos)" }];

export const SKIN_TONES: (NamedItem & { color: string; shade: string })[] = [
  { name: "Clara", color: "#f2cba6", shade: "#d9a883" },
  { name: "Pêssego", color: "#e3b085", shade: "#c78f66" },
  { name: "Morena", color: "#c98c5a", shade: "#a86f43" },
  { name: "Canela", color: "#a8703f", shade: "#8a5731" },
  { name: "Escura", color: "#7c4e2e", shade: "#613b21" },
  { name: "Ébano", color: "#5a3721", shade: "#442816" },
];

export const HAIR_STYLES: NamedItem[] = [
  { name: "Curto" },
  { name: "Moicano" },
  { name: "Longo" },
  { name: "Careca" },
  { name: "Rabo de cavalo" },
  { name: "Cacheado" },
  { name: "Espetado" },
];

export const HAIR_COLORS: (NamedItem & { color: string })[] = [
  { name: "Preto", color: "#1c1510" },
  { name: "Castanho escuro", color: "#3e2a17" },
  { name: "Castanho", color: "#6e4524" },
  { name: "Ruivo", color: "#b25a24" },
  { name: "Loiro", color: "#dcc27a" },
  { name: "Grisalho", color: "#b9b6b0" },
  { name: "Azul", color: "#3a64d8" },
  { name: "Rosa", color: "#d4467e" },
];

export interface OutfitDef extends NamedItem {
  /** jaqueta / camisa */
  top: string;
  topShade: string;
  /** detalhe (gola, zíper, camiseta por baixo) */
  accent: string;
  pants: string;
  pantsShade: string;
  /** padrão extra desenhado por cima */
  pattern?: "camo" | "quilt" | "trim" | "leather" | "stripe";
  patternColor?: string;
}

export const OUTFITS: OutfitDef[] = [
  { name: "Recruta", top: "#3b5ba5", topShade: "#2c4580", accent: "#9aa8b8", pants: "#2e3d31", pantsShade: "#222d24" },
  { name: "Deserto", top: "#b89c6a", topShade: "#96794d", accent: "#e8d9b0", pants: "#5c4a35", pantsShade: "#463726", pattern: "stripe", patternColor: "#7d6644" },
  { name: "Urbano", top: "#5f646c", topShade: "#474b52", accent: "#c9c9c4", pants: "#27292e", pantsShade: "#1b1d21" },
  { name: "Selva", top: "#546e3c", topShade: "#40562d", accent: "#2f3b22", pants: "#3f4a2c", pantsShade: "#2f3821", pattern: "camo", patternColor: "#33421f" },
  { name: "Noturno", top: "#20232a", topShade: "#15171c", accent: "#c83a3a", pants: "#17191e", pantsShade: "#0f1014" },
  { name: "Carmim", top: "#a8392f", topShade: "#832a22", accent: "#f0d9b0", pants: "#2b2e3a", pantsShade: "#1f212b" },
  { name: "Neve", top: "#dfe4e8", topShade: "#b9c0c6", accent: "#5a8ab8", pants: "#6c737b", pantsShade: "#555b62", pattern: "quilt", patternColor: "#c4cbd1" },
  { name: "Traje Sombrio", top: "#15161a", topShade: "#0b0c0f", accent: "#3a3d45", pants: "#121317", pantsShade: "#0a0b0d", pattern: "quilt", patternColor: "#24262c" },
  { name: "Real", top: "#5b3b8e", topShade: "#452c6d", accent: "#e2b84a", pants: "#2c2340", pantsShade: "#201930", pattern: "trim", patternColor: "#e2b84a" },
  { name: "Motoqueiro", top: "#5e3c25", topShade: "#472c1a", accent: "#c9a26b", pants: "#34466a", pantsShade: "#263552", pattern: "leather", patternColor: "#7a5236" },
];

export interface ArmorDef extends NamedItem {
  style: "none" | "vest" | "plate" | "knight" | "neon" | "bone" | "dark" | "gold";
  main: string;
  shade: string;
  trim: string;
  glow?: string;
}

export const ARMORS: ArmorDef[] = [
  { name: "Nenhuma", style: "none", main: "", shade: "", trim: "" },
  { name: "Colete Tático", style: "vest", main: "#4c5a39", shade: "#38432a", trim: "#2a3120" },
  { name: "Placa de Aço", style: "plate", main: "#a3acb6", shade: "#78818b", trim: "#5c636b" },
  { name: "Cavaleiro", style: "knight", main: "#b8c0c8", shade: "#8a939c", trim: "#d8b04a" },
  { name: "Neon", style: "neon", main: "#171b22", shade: "#0e1116", trim: "#2b323d", glow: "#38e8ff" },
  { name: "Ossos", style: "bone", main: "#dcd2b8", shade: "#b3a88c", trim: "#6e6450" },
  { name: "Couraça Sombria", style: "dark", main: "#1b1c21", shade: "#0f1013", trim: "#4a4d57" },
  { name: "Dourada", style: "gold", main: "#d1a53c", shade: "#a47c22", trim: "#fff0b0" },
];

export interface BootsDef extends NamedItem {
  style: "sneaker" | "combat" | "leather" | "space" | "cowboy" | "dark" | "sandal" | "draft";
  main: string;
  shade: string;
  sole: string;
  accent: string;
}

export const BOOTS: BootsDef[] = [
  { name: "Tênis", style: "sneaker", main: "#eceae4", shade: "#c9c6bd", sole: "#ffffff", accent: "#d13a34" },
  { name: "Coturno", style: "combat", main: "#24262a", shade: "#16171a", sole: "#0c0c0e", accent: "#4a4d52" },
  { name: "Botas de Couro", style: "leather", main: "#6b4426", shade: "#4f311a", sole: "#2a1a10", accent: "#a0703e" },
  { name: "Botas Espaciais", style: "space", main: "#d8dee6", shade: "#aab3be", sole: "#38e8ff", accent: "#7c8794" },
  { name: "Botas de Cowboy", style: "cowboy", main: "#9a6a3a", shade: "#7a5028", sole: "#3a2414", accent: "#d8b47a" },
  { name: "Botas Sombrias", style: "dark", main: "#101114", shade: "#07080a", sole: "#050506", accent: "#5c606a" },
  { name: "Chinelo", style: "sandal", main: "#2f6fd0", shade: "#24569f", sole: "#f2f2ee", accent: "#ffd23a" },
  { name: "Botas Rascunho", style: "draft", main: "#e07a3a", shade: "#b85a26", sole: "#f0c060", accent: "#f0c060" },
];

export interface CapeDef extends NamedItem {
  style: "none" | "hero" | "royal" | "dark" | "gold" | "tattered" | "emerald" | "rainbow" | "draftRecoil" | "draftShield";
  main: string;
  inner: string;
  trim: string;
}

export const CAPES: CapeDef[] = [
  { name: "Nenhuma", style: "none", main: "", inner: "", trim: "" },
  { name: "Heroica", style: "hero", main: "#c0282c", inner: "#7e1519", trim: "#f0c040" },
  { name: "Real", style: "royal", main: "#27448f", inner: "#172b5c", trim: "#f2f0ea" },
  { name: "Sombria", style: "dark", main: "#141418", inner: "#07070a", trim: "#34363d" },
  { name: "Dourada", style: "gold", main: "#d4a634", inner: "#9c2a26", trim: "#fff2b8" },
  { name: "Esfarrapada", style: "tattered", main: "#6e5a44", inner: "#4a3b2c", trim: "#8a7458" },
  { name: "Esmeralda", style: "emerald", main: "#1f7a4d", inner: "#11492d", trim: "#e2c25a" },
  { name: "Arco-íris", style: "rainbow", main: "#e04040", inner: "#5a2a8a", trim: "#ffffff" },
  { name: "Capa Rascunho (Recuo)", style: "draftRecoil", main: "#5a1838", inner: "#8a3060", trim: "#c04070" },
  { name: "Capa Rascunho (Escudo)", style: "draftShield", main: "#3a4a58", inner: "#5a7a90", trim: "#8ab0c8" },
];

export interface HelmetDef extends NamedItem {
  style: "none" | "cap" | "army" | "knight" | "darkLord" | "bandana" | "hood" | "crown" | "visor";
  main: string;
  shade: string;
  accent: string;
}

export const HELMETS: HelmetDef[] = [
  { name: "Nenhum", style: "none", main: "", shade: "", accent: "" },
  { name: "Boné", style: "cap", main: "#c83a34", shade: "#9a2a26", accent: "#f2f0ea" },
  { name: "Capacete Militar", style: "army", main: "#56663f", shade: "#3f4b2e", accent: "#2c3420" },
  { name: "Elmo de Cavaleiro", style: "knight", main: "#b8c0c8", shade: "#868f99", accent: "#c0282c" },
  { name: "Elmo Sombrio", style: "darkLord", main: "#111215", shade: "#060608", accent: "#8a8f9a" },
  { name: "Bandana", style: "bandana", main: "#b8302c", shade: "#8a2220", accent: "#f2f0ea" },
  { name: "Capuz", style: "hood", main: "#3a3530", shade: "#26221e", accent: "#57504a" },
  { name: "Coroa", style: "crown", main: "#e2b84a", shade: "#b08a2a", accent: "#d23a4a" },
  { name: "Visor Neon", style: "visor", main: "#1d222a", shade: "#12151a", accent: "#38e8ff" },
];

/** Quantas opções cada slot tem (validação no host). */
export const LOOK_SIZES: Record<LookKey, number> = {
  body: BODIES.length,
  skin: SKIN_TONES.length,
  hair: HAIR_STYLES.length,
  hairColor: HAIR_COLORS.length,
  outfit: OUTFITS.length,
  armor: ARMORS.length,
  boots: BOOTS.length,
  cape: CAPES.length,
  helmet: HELMETS.length,
  gun: GUN_STYLES.length,
  fx: FX_STYLES.length,
};

export const DEFAULT_LOOK: Look = {
  body: 0,
  skin: 1,
  hair: 0,
  hairColor: 1,
  outfit: 0,
  armor: 0,
  boots: 0,
  cape: 0,
  helmet: 0,
  gun: 0,
  fx: 0,
};

export interface LookPreset {
  name: string;
  desc: string;
  look: Look;
}

/** Skins inteiras (atalhos que preenchem todos os slots). */
export const PRESETS: LookPreset[] = [
  { name: "Recruta", desc: "O visual padrão.", look: { ...DEFAULT_LOOK } },
  {
    name: "Lorde Sombrio",
    desc: "Inspirado no Darth Vader: elmo, couraça com painel de luzes, capa e botas pretas.",
    look: { body: 0, skin: 0, hair: 3, hairColor: 0, outfit: 7, armor: 6, boots: 5, cape: 3, helmet: 4, gun: 0, fx: 0 },
  },
  {
    name: "Cavaleiro",
    desc: "Armadura de placas, elmo com pluma e capa real.",
    look: { body: 0, skin: 1, hair: 0, hairColor: 2, outfit: 2, armor: 3, boots: 1, cape: 2, helmet: 3, gun: 0, fx: 0 },
  },
  {
    name: "Soldado",
    desc: "Camuflado, colete tático e capacete.",
    look: { body: 0, skin: 2, hair: 0, hairColor: 0, outfit: 3, armor: 1, boots: 1, cape: 0, helmet: 2, gun: 0, fx: 0 },
  },
  {
    name: "Neon",
    desc: "Armadura com linhas de energia e visor.",
    look: { body: 0, skin: 3, hair: 6, hairColor: 6, outfit: 4, armor: 4, boots: 3, cape: 0, helmet: 8, gun: 0, fx: 0 },
  },
  {
    name: "Rei",
    desc: "Coroa, placas douradas e capa de ouro.",
    look: { body: 0, skin: 1, hair: 2, hairColor: 4, outfit: 8, armor: 7, boots: 2, cape: 4, helmet: 7, gun: 0, fx: 0 },
  },
  {
    name: "Andarilho",
    desc: "Capuz, roupa de deserto e capa esfarrapada.",
    look: { body: 0, skin: 2, hair: 2, hairColor: 2, outfit: 1, armor: 0, boots: 4, cape: 5, helmet: 6, gun: 0, fx: 0 },
  },
  {
    name: "Herói",
    desc: "Jaqueta carmim, placa de aço e capa heroica.",
    look: { body: 0, skin: 0, hair: 6, hairColor: 3, outfit: 5, armor: 2, boots: 2, cape: 1, helmet: 0, gun: 0, fx: 0 },
  },
  {
    name: "Rascunho",
    desc: "O boneco antigo (sprite) com os itens, armas e poderes antigos.",
    look: { ...DEFAULT_LOOK, body: 1, gun: 1, fx: 1 },
  },
];

function clampInt(v: unknown, n: number, fallback: number): number {
  const x = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return x >= 0 && x < n ? x : fallback;
}

/** Garante índices válidos (dados vêm da rede / localStorage). */
export function sanitizeLook(raw: Partial<Look> | null | undefined): Look {
  const out = { ...DEFAULT_LOOK };
  if (!raw) return out;
  for (const k of LOOK_KEYS) out[k] = clampInt(raw[k], LOOK_SIZES[k], DEFAULT_LOOK[k]);
  return out;
}

export function encodeLook(look: Look): number[] {
  return LOOK_KEYS.map((k) => look[k] & 0xff);
}

export function decodeLook(bytes: ArrayLike<number> | null | undefined): Look | null {
  if (!bytes || bytes.length < LOOK_MIN_BYTES) return null;
  const raw: Partial<Look> = {};
  LOOK_KEYS.forEach((k, i) => {
    if (i < bytes.length) raw[k] = Number(bytes[i]);
  });
  return sanitizeLook(raw);
}

function hashId(id: number, salt: number): number {
  let h = Math.imul(id + 1, 2654435761) ^ Math.imul(salt + 7, 40503);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Visual variado e determinístico (bots / quem ainda não mandou o visual). */
export function autoLookFor(id: number): Look {
  // bots vestem skins inteiras de vez em quando
  const presetRoll = hashId(id, 1) % 10;
  if (presetRoll < 4) {
    const pool = PRESETS.filter((p) => p.look.body === 0);
    return { ...pool[hashId(id, 2) % pool.length]!.look };
  }
  const pick = (k: LookKey, salt: number) => hashId(id, salt) % LOOK_SIZES[k];
  return sanitizeLook({
    body: 0,
    skin: pick("skin", 11),
    hair: pick("hair", 12),
    hairColor: pick("hairColor", 13),
    outfit: pick("outfit", 14),
    armor: hashId(id, 15) % 3 === 0 ? pick("armor", 16) : 0,
    boots: pick("boots", 17) % (LOOK_SIZES.boots - 1),
    cape: hashId(id, 18) % 4 === 0 ? 1 + (hashId(id, 19) % (LOOK_SIZES.cape - 3)) : 0,
    helmet: hashId(id, 20) % 3 === 0 ? pick("helmet", 21) : 0,
    gun: 0,
    fx: 0,
  });
}

export function lookEquals(a: Look, b: Look): boolean {
  return LOOK_KEYS.every((k) => a[k] === b[k]);
}
