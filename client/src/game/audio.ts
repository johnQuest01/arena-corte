/**
 * audio.ts — Web Audio pool, CC0 Kenney SFX, volume por distância.
 */
import { WEAPON_SFX } from "../../../shared/gear";

const NAMES = [
  ...WEAPON_SFX,
  "reload",
  "empty_click",
  "pickup",
  "explosion",
  "hit_flesh",
  "door",
  "footstep_1",
  "footstep_2",
  "footstep_3",
] as const;

export type SfxName = (typeof NAMES)[number] | string;

const AUDIBLE = 700;
let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
let unlocked = false;
let master = 0.85;
let muted = false;
let footIdx = 0;

function ensureCtx() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export async function preloadSfx(): Promise<void> {
  const ac = ensureCtx();
  await Promise.all(
    NAMES.map(async (name) => {
      try {
        const res = await fetch(`/assets/sfx/${name}.ogg`);
        if (!res.ok) return;
        const ab = await res.arrayBuffer();
        const buf = await ac.decodeAudioData(ab.slice(0));
        buffers.set(name, buf);
      } catch {
        /* ignore missing */
      }
    }),
  );
}

export function unlockAudio() {
  const ac = ensureCtx();
  if (ac.state === "suspended") void ac.resume();
  unlocked = true;
}

export function setMasterVolume(v: number) {
  master = Math.max(0, Math.min(1, v));
}

export function setMuted(m: boolean) {
  muted = m;
}

export function getMasterVolume() {
  return master;
}

export function isMuted() {
  return muted;
}

/** zzfx-style tiny beep — só UI/fallback, nunca arma. */
function synthClick() {
  const ac = ensureCtx();
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = "square";
  o.frequency.value = 880;
  g.gain.value = muted ? 0 : 0.04 * master;
  o.connect(g);
  g.connect(ac.destination);
  o.start();
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.06);
  o.stop(ac.currentTime + 0.07);
}

export function playSfx(
  name: SfxName,
  x?: number,
  y?: number,
  listener?: { x: number; y: number },
) {
  if (!unlocked) return;
  if (muted || master <= 0) return;
  const ac = ensureCtx();
  const buf = buffers.get(name);
  if (!buf) {
    if (name === "empty_click" || name === "pickup" || name === "reload") synthClick();
    return;
  }

  let vol = master;
  let pan = 0;
  if (listener && x != null && y != null) {
    const dx = x - listener.x;
    const dy = y - listener.y;
    const dist = Math.hypot(dx, dy);
    vol = master * Math.max(0.05, 1 - dist / AUDIBLE);
    pan = Math.max(-0.85, Math.min(0.85, dx / AUDIBLE));
  }

  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.94 + Math.random() * 0.12;
  const gain = ac.createGain();
  gain.gain.value = vol;
  const panner = ac.createStereoPanner();
  panner.pan.value = pan;
  src.connect(gain);
  gain.connect(panner);
  panner.connect(ac.destination);
  src.start();
}

export function playWeaponShot(weapon: number, x: number, y: number, listener: { x: number; y: number }) {
  const name = WEAPON_SFX[weapon] ?? "pistol";
  playSfx(name, x, y, listener);
}

export function playFootstep(x: number, y: number, listener: { x: number; y: number }) {
  footIdx = (footIdx % 3) + 1;
  playSfx(`footstep_${footIdx}`, x, y, listener);
}
