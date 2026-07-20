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
  "giant_step",
  "giant_roar",
  "giant_roar_short",
  "giant_hit",
  "boost",
  "block",
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
      for (const ext of ["ogg", "wav"] as const) {
        try {
          const res = await fetch(`/assets/sfx/${name}.${ext}`);
          if (!res.ok) continue;
          const ab = await res.arrayBuffer();
          const buf = await ac.decodeAudioData(ab.slice(0));
          buffers.set(name, buf);
          return;
        } catch {
          /* try next ext */
        }
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

function synthWhoosh() {
  const ac = ensureCtx();
  const len = Math.floor(ac.sampleRate * 0.35);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ac.sampleRate;
    const env = Math.exp(-t * 6) * (1 - t / 0.35);
    data[i] = (Math.random() * 2 - 1) * env * 0.4;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900;
  filter.Q.value = 0.7;
  const gain = ac.createGain();
  gain.gain.value = muted ? 0 : 0.55 * master;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  src.start();
}

function synthSplash() {
  const ac = ensureCtx();
  const len = Math.floor(ac.sampleRate * 0.22);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ac.sampleRate;
    const env = Math.exp(-t * 14) * (0.4 + 0.6 * Math.random());
    data[i] = (Math.random() * 2 - 1) * env * 0.45;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1400;
  const gain = ac.createGain();
  gain.gain.value = muted ? 0 : 0.5 * master;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  src.start();
}

/** Fallback grave se giant_*.wav/ogg faltar — ainda posicional via vol externo. */
function synthGiant(kind: "step" | "roar" | "roar_short" | "hit", volScale: number) {
  const ac = ensureCtx();
  const dur =
    kind === "roar" ? 1.05 : kind === "roar_short" ? 0.32 : kind === "hit" ? 0.26 : 0.16;
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ac.sampleRate;
    let env = Math.exp(-t * (kind === "roar" ? 3.2 : kind === "roar_short" ? 9 : 22));
    if (kind === "roar" || kind === "roar_short") env *= Math.min(1, t * 10);
    const f0 = kind === "step" ? 55 : kind === "hit" ? 70 : 88 + Math.sin(t * 7) * 28;
    let s = Math.sin(2 * Math.PI * f0 * t) * 0.55;
    s += Math.sin(2 * Math.PI * (f0 * 0.5) * t) * 0.35;
    s += (Math.random() * 2 - 1) * (kind === "step" ? 0.3 : 0.42);
    data[i] = Math.max(-1, Math.min(1, s * env));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = kind === "roar" || kind === "roar_short" ? 900 : 480;
  const gain = ac.createGain();
  gain.gain.value = muted ? 0 : volScale * master * 0.7;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  src.start();
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
  let buf = buffers.get(name);
  // fallbacks CC0 já no pack se giant_* ausente
  if (!buf && name === "giant_step") buf = buffers.get("explosion");
  else if (!buf && (name === "giant_roar" || name === "giant_roar_short")) {
    buf = buffers.get("explosion");
  } else if (!buf && name === "giant_hit") buf = buffers.get("hit_flesh");
  if (!buf) {
    if (name === "empty_click" || name === "pickup" || name === "reload") synthClick();
    if (name === "water_whoosh" || name === "boost") synthWhoosh();
    if (name === "block") synthClick();
    if (name === "splash") synthSplash();
    if (name === "giant_step") synthGiant("step", 0.9);
    if (name === "giant_roar") synthGiant("roar", 1);
    if (name === "giant_roar_short") synthGiant("roar_short", 0.95);
    if (name === "giant_hit") synthGiant("hit", 1);
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
