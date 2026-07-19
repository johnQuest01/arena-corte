/**
 * art.ts — loader de assets pixel (manifest + PNGs). Fallback silencioso se faltar.
 */
export type CharAnimState = "idle" | "walk" | "death";

export interface AnimDef {
  file: string;
  frames: number;
  fps: number;
  img?: HTMLImageElement;
}

export interface CharDef {
  id: number;
  idle?: AnimDef;
  walk?: AnimDef;
  death?: AnimDef;
  /** Sheet 8×N (Atomic Exile / 3/4): cols = frames, rows = direções — ou 8×8 misto. */
  dirs?: { file: string; cols: number; rows: number; frameSize: number; fps: number };
}

export interface ArtManifest {
  frameSize: number;
  chars: CharDef[];
  guns: Record<string, string>;
  throws: Record<string, string>;
  items: Record<string, string>;
  tiles: {
    sand?: string[];
    floorWood?: string;
    floorConcrete?: string;
    wall?: string;
    roof?: string;
  };
  props: Record<string, string>;
  door?: string;
}

export interface CharDirsSheet {
  img: HTMLImageElement;
  cols: number;
  rows: number;
  frameSize: number;
  fps: number;
}

const BASE = "/assets/art";

let manifest: ArtManifest | null = null;
const images = new Map<string, HTMLImageElement>();
let ready = false;
let loading: Promise<void> | null = null;

function loadImage(file: string): Promise<HTMLImageElement | null> {
  const key = file;
  const cached = images.get(key);
  if (cached?.complete && cached.naturalWidth > 0) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      images.set(key, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = `${BASE}/${file}`;
  });
}

async function loadAnim(def?: AnimDef): Promise<AnimDef | undefined> {
  if (!def?.file) return undefined;
  const img = await loadImage(def.file);
  if (!img) return undefined;
  return { ...def, img };
}

export async function preloadArt(): Promise<void> {
  if (ready) return;
  if (loading) return loading;

  loading = (async () => {
    try {
      const res = await fetch(`${BASE}/manifest.json`);
      if (!res.ok) {
        ready = true;
        return;
      }
      const raw = (await res.json()) as ArtManifest;
      const chars: CharDef[] = [];
      for (const c of raw.chars ?? []) {
        let dirs = c.dirs;
        if (dirs?.file) {
          const dimg = await loadImage(dirs.file);
          if (!dimg) dirs = undefined;
          else dirs = { ...dirs };
        } else {
          dirs = undefined;
        }
        chars.push({
          id: c.id,
          idle: await loadAnim(c.idle),
          walk: await loadAnim(c.walk),
          death: await loadAnim(c.death),
          dirs,
        });
      }

      const guns: Record<string, string> = {};
      for (const [k, file] of Object.entries(raw.guns ?? {})) {
        if (await loadImage(file)) guns[k] = file;
      }

      const throws: Record<string, string> = {};
      for (const [k, file] of Object.entries(raw.throws ?? {})) {
        if (await loadImage(file)) throws[k] = file;
      }

      const items: Record<string, string> = {};
      for (const [k, file] of Object.entries(raw.items ?? {})) {
        if (await loadImage(file)) items[k] = file;
      }

      const tiles = { ...raw.tiles };
      if (tiles.sand) {
        const ok: string[] = [];
        for (const f of tiles.sand) {
          if (await loadImage(f)) ok.push(f);
        }
        tiles.sand = ok.length ? ok : undefined;
      }
      for (const key of ["floorWood", "floorConcrete", "wall", "roof"] as const) {
        const f = tiles[key];
        if (f && !(await loadImage(f))) delete tiles[key];
      }

      const props: Record<string, string> = {};
      for (const [k, file] of Object.entries(raw.props ?? {})) {
        if (await loadImage(file)) props[k] = file;
      }

      let door = raw.door;
      if (door && !(await loadImage(door))) door = undefined;

      manifest = {
        frameSize: raw.frameSize || 32,
        chars,
        guns,
        throws,
        items,
        tiles,
        props,
        door,
      };
    } catch {
      manifest = null;
    } finally {
      ready = true;
    }
  })();

  return loading;
}

export function artReady() {
  return ready;
}

export function getFrameSize() {
  return manifest?.frameSize ?? 32;
}

export function getImg(file: string | undefined): HTMLImageElement | null {
  if (!file) return null;
  const img = images.get(file);
  if (!img || !img.complete || img.naturalWidth <= 0) return null;
  return img;
}

export function getCharAnim(
  id: number,
  state: CharAnimState,
): { img: HTMLImageElement; frames: number; fps: number; frameSize: number } | null {
  if (!manifest) return null;
  const c = manifest.chars.find((x) => x.id === id) ?? manifest.chars[id];
  if (!c) return null;
  const def = c[state] ?? (state === "walk" ? c.idle : state === "death" ? c.idle : undefined);
  if (!def?.img) return null;
  return {
    img: def.img,
    frames: Math.max(1, def.frames | 0),
    fps: Math.max(0.1, def.fps),
    frameSize: manifest.frameSize,
  };
}

export function getGunImg(weaponId: number): HTMLImageElement | null {
  const file = manifest?.guns[String(weaponId)];
  return getImg(file);
}

/** Sheet de 8 direções (3/4). Preferir isto ao perfil lateral. */
export function getCharDirs(id: number): CharDirsSheet | null {
  if (!manifest) return null;
  // bots/outros jogadores sem skin própria herdam o char0
  const c =
    manifest.chars.find((x) => x.id === id) ??
    manifest.chars.find((x) => x.dirs?.file) ??
    manifest.chars[0];
  if (!c?.dirs?.file) return null;
  const img = getImg(c.dirs.file);
  if (!img) return null;
  return {
    img,
    cols: Math.max(1, c.dirs.cols | 0),
    rows: Math.max(1, c.dirs.rows | 0),
    frameSize: c.dirs.frameSize || manifest.frameSize || 32,
    fps: Math.max(0.1, c.dirs.fps || 10),
  };
}

/** Ângulo de mira → setor 0..7 (0 = leste / direita). */
export function aimToDir8(angle: number): number {
  return ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
}

export function drawDirFrame(
  ctx: CanvasRenderingContext2D,
  sheet: CharDirsSheet,
  dir: number,
  frame: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const fs = sheet.frameSize;
  const col = ((frame % sheet.cols) + sheet.cols) % sheet.cols;
  const row = ((dir % sheet.rows) + sheet.rows) % sheet.rows;
  ctx.drawImage(sheet.img, col * fs, row * fs, fs, fs, dx, dy, dw, dh);
}

export function getThrowImg(kind: number): HTMLImageElement | null {
  const file = manifest?.throws[String(kind)];
  return getImg(file);
}

export function getItemImg(key: string): HTMLImageElement | null {
  return getImg(manifest?.items[key]);
}

export function getTileImg(
  kind: "sand" | "floorWood" | "floorConcrete" | "wall" | "roof",
  tx = 0,
  ty = 0,
): HTMLImageElement | null {
  if (!manifest?.tiles) return null;
  if (kind === "sand") {
    const list = manifest.tiles.sand;
    if (!list?.length) return null;
    const i = Math.abs(tx * 17 + ty * 31) % list.length;
    return getImg(list[i]);
  }
  return getImg(manifest.tiles[kind]);
}

export function getPropImg(key: "crate" | "barrel" | "car"): HTMLImageElement | null {
  return getImg(manifest?.props[key]);
}

export function getDoorImg(): HTMLImageElement | null {
  return getImg(manifest?.door);
}

/** Desenha frame de sheet horizontal. */
export function drawSheetFrame(
  ctx: CanvasRenderingContext2D,
  anim: { img: HTMLImageElement; frames: number; frameSize: number },
  frame: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const fs = anim.frameSize;
  const f = ((frame % anim.frames) + anim.frames) % anim.frames;
  ctx.drawImage(anim.img, f * fs, 0, fs, fs, dx, dy, dw, dh);
}
