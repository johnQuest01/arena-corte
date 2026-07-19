/**
 * Carrega sprites Kenney Top-down Shooter (CC0 — kenney.nl).
 * Layout: personagem visto de cima; arma aponta pra “cima” na imagem → rotacionamos pelo aim.
 */

export type CharPose = "stand" | "gun" | "machine" | "hold";

const poses: CharPose[] = ["stand", "gun", "machine", "hold"];
const skins = [0, 1, 2] as const;

const cache = new Map<string, HTMLImageElement>();
let ready = false;
let loading: Promise<void> | null = null;

function key(skin: number, pose: CharPose) {
  return `p${skin % 3}/${pose}`;
}

export function preloadKenneySprites(): Promise<void> {
  if (ready) return Promise.resolve();
  if (loading) return loading;

  loading = (async () => {
    const jobs: Promise<void>[] = [];
    for (const s of skins) {
      for (const pose of poses) {
        const k = key(s, pose);
        const img = new Image();
        img.decoding = "async";
        const p = new Promise<void>((res) => {
          img.onload = () => {
            cache.set(k, img);
            res();
          };
          img.onerror = () => res();
          img.src = `/assets/chars/p${s}/${pose}.png`;
        });
        jobs.push(p);
      }
    }
    await Promise.all(jobs);
    ready = cache.size > 0;
  })();

  return loading;
}

export function kenneyReady() {
  return ready;
}

/** Pose conforme arma + movimento (informations.MD: sprite + balanço). */
export function pickPose(weapon: number, speed: number): CharPose {
  if (speed < 25) {
    if (weapon === 0) return "gun";
    return "machine";
  }
  if (weapon === 0) return "hold";
  return "machine";
}

export function getCharSprite(skin: number, pose: CharPose): HTMLImageElement | null {
  return cache.get(key(skin, pose)) ?? cache.get(key(skin, "gun")) ?? null;
}
