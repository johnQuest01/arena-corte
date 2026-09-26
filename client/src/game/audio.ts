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
let sfxReady = false;
let sfxLoading: Promise<void> | null = null;

function ensureCtx() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export type SfxProgress = (loaded: number, total: number) => void;

export async function preloadSfx(onProgress?: SfxProgress): Promise<void> {
  const total = NAMES.length;
  if (sfxReady) {
    onProgress?.(total, total);
    return;
  }
  if (sfxLoading) {
    await sfxLoading;
    onProgress?.(total, total);
    return;
  }

  sfxLoading = (async () => {
    const ac = ensureCtx();
    let loaded = 0;
    const tick = () => {
      loaded++;
      onProgress?.(loaded, total);
    };
    onProgress?.(0, total);

    await Promise.all(
      NAMES.map(async (name) => {
        try {
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
        } finally {
          tick();
        }
      }),
    );
    sfxReady = true;
  })();

  await sfxLoading;
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

/** Cristais se formando — agudo + shimmer. */
function synthFreeze() {
  const ac = ensureCtx();
  const len = Math.floor(ac.sampleRate * 0.38);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ac.sampleRate;
    const env = Math.min(1, t * 18) * Math.exp(-t * 5.5);
    const shimmer =
      Math.sin(2 * Math.PI * (1800 + t * 900) * t) * 0.35 +
      Math.sin(2 * Math.PI * (3200 + Math.sin(t * 40) * 400) * t) * 0.22;
    const crackle = (Math.random() * 2 - 1) * Math.exp(-t * 10) * 0.28;
    data[i] = Math.max(-1, Math.min(1, (shimmer + crackle) * env));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 600;
  const gain = ac.createGain();
  gain.gain.value = muted ? 0 : 0.55 * master;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  src.start();
}

/** Bloco rachando — cacos agudos caindo. */
function synthIceShatter() {
  const ac = ensureCtx();
  const len = Math.floor(ac.sampleRate * 0.32);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ac.sampleRate;
    const env = Math.exp(-t * 9) * (0.5 + 0.5 * Math.random());
    const ting = Math.sin(2 * Math.PI * (2400 + t * 1600) * t) * Math.exp(-t * 14);
    const glass = (Math.random() * 2 - 1) * env * 0.55;
    data[i] = Math.max(-1, Math.min(1, ting * 0.45 + glass));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2800;
  filter.Q.value = 0.8;
  const gain = ac.createGain();
  gain.gain.value = muted ? 0 : 0.58 * master;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  src.start();
}

/** Choque elétrico (Raio em Cadeia) — crepitar + zumbido. */
function synthZap(vol: number) {
  const ac = ensureCtx();
  const len = Math.floor(ac.sampleRate * 0.28);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  let hold = 0;
  for (let i = 0; i < len; i++) {
    const t = i / ac.sampleRate;
    const env = Math.min(1, t * 60) * Math.exp(-t * 9);
    if (i % 24 === 0) hold = Math.random() * 2 - 1;
    const buzz = Math.sign(Math.sin(2 * Math.PI * (120 + Math.random() * 30) * t)) * 0.25;
    data[i] = Math.max(-1, Math.min(1, (hold * 0.7 + buzz) * env));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 350;
  const gain = ac.createGain();
  gain.gain.value = muted ? 0 : 0.42 * vol;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  src.start();
}

/** Metal do escudo (ricochete / pegar de volta). */
function synthClang(vol: number) {
  const ac = ensureCtx();
  const len = Math.floor(ac.sampleRate * 0.45);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ac.sampleRate;
    const env = Math.exp(-t * 7);
    const ring =
      Math.sin(2 * Math.PI * 1320 * t) * 0.4 +
      Math.sin(2 * Math.PI * 2210 * t) * 0.25 +
      Math.sin(2 * Math.PI * 3470 * t) * 0.12;
    const hit = (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.6;
    data[i] = Math.max(-1, Math.min(1, (ring + hit) * env));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const gain = ac.createGain();
  gain.gain.value = muted ? 0 : 0.34 * vol;
  src.connect(gain);
  gain.connect(ac.destination);
  src.start();
}

/** Teleporte (Passo Sombrio) — sucção grave invertida. */
function synthBlink(vol: number) {
  const ac = ensureCtx();
  const len = Math.floor(ac.sampleRate * 0.3);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ac.sampleRate;
    const env = Math.pow(t / 0.3, 1.6) * (1 - t / 0.3) * 4;
    const tone = Math.sin(2 * Math.PI * (160 + t * 900) * t) * 0.5;
    data[i] = Math.max(-1, Math.min(1, (tone + (Math.random() * 2 - 1) * 0.3) * env));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2200;
  const gain = ac.createGain();
  gain.gain.value = muted ? 0 : 0.5 * vol;
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
  opts?: { volumeMul?: number; rate?: number },
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
  else if (!buf && (name === "earth_slam" || name === "collapse")) {
    buf = buffers.get("explosion");
  } else if (!buf && name === "big_explosion") {
    buf = buffers.get("explosion");
  }
  if (!buf) {
    // sintetizados com volume por distância
    if (name === "zap" || name === "clang" || name === "blink") {
      let v = master * (opts?.volumeMul ?? 1);
      if (listener && x != null && y != null) {
        v *= Math.max(0.05, 1 - Math.hypot(x - listener.x, y - listener.y) / AUDIBLE);
      }
      if (name === "zap") synthZap(v);
      else if (name === "clang") synthClang(v);
      else synthBlink(v);
      return;
    }
    if (name === "empty_click" || name === "pickup" || name === "reload") synthClick();
    if (name === "water_whoosh" || name === "boost" || name === "earth_crack") synthWhoosh();
    if (name === "earth_slam" || name === "collapse") synthGiant("hit", 1.1);
    if (name === "big_explosion") synthGiant("hit", 1.35);
    if (name === "block") synthClick();
    if (name === "splash") synthSplash();
    if (name === "freeze") synthFreeze();
    if (name === "ice_shatter") synthIceShatter();
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
  vol *= opts?.volumeMul ?? 1;

  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = opts?.rate ?? 0.94 + Math.random() * 0.12;
  const gain = ac.createGain();
  gain.gain.value = Math.min(1.4, vol);
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
