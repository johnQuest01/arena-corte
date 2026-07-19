/**
 * loop.ts — requestAnimationFrame + netcode (prediction / reconciliação / interp).
 */
import { ARENA_H, ARENA_W, INPUT_HZ } from "../../../shared/constants";
import { WEAPONS } from "../../../shared/gear";
import {
  MSG,
  decodeLobby,
  decodePingTime,
  decodeSnapshot,
  decodeWelcome,
  encodeHello,
  encodeInput,
  encodePing,
  encodeCtrl,
  msgType,
  type LobbyMsg,
  type PlayerInput,
  type Snapshot,
  type WelcomeMsg,
} from "../../../shared/protocol";
import type { Transport } from "../net/transport";
import { InterpBuffer } from "../net/interpolation";
import { PredictionBuffer } from "../net/prediction";
import {
  createSmooth,
  reconcile,
  stepSmooth,
  type SmoothState,
} from "../net/reconciliation";
import { weaponOf } from "../../../shared/gear";
import {
  getMasterVolume,
  isMuted,
  playFootstep,
  playSfx,
  playWeaponShot,
  preloadSfx,
  setMasterVolume,
  setMuted,
  unlockAudio,
} from "./audio";
import { preloadArt } from "./art";
import {
  clearDecals,
  drawDecalLayer,
  drawGoreActors,
  hitFlashActive,
  initDecals,
  processGoreEvents,
  spawnDust,
  stampBulletMark,
  stampShell,
  tickGore,
} from "./gore";
import { InputController } from "./input";
import {
  cameraScreenLayout,
  computeCamera,
  createFeel,
  drawFrame,
  invalidateGroundCache,
  pulseShotFeel,
  pushFlashesFromEvents,
  pushFxFromEvents,
  resizeCanvas,
  tickDoorAnim,
  tickFeel,
  tickFlashes,
  tickFx,
  tickRoofAlpha,
  type FeelState,
  type FxPool,
  type MuzzleFlash,
  type RenderView,
} from "./render";

export type GamePhase = "connecting" | "lobby" | "playing" | "result" | "full" | "error";

export interface GameHud {
  phase: GamePhase;
  ping: number;
  lobby: LobbyMsg | null;
  welcome: WelcomeMsg | null;
  snapshot: Snapshot | null;
  selfHp: number;
  stamina: number;
  weaponName: string;
  mag: number;
  reserve: number;
  reloadProgress: number;
  error?: string;
}

export type HudListener = (hud: GameHud) => void;

export class GameClient {
  private transport: Transport;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private input = new InputController();
  private prediction = new PredictionBuffer();
  private interp = new InterpBuffer();
  private smooth: SmoothState | null = null;
  private seq = 1;
  private selfId = -1;
  private name: string;
  private flashes: MuzzleFlash[] = [];
  private fx: FxPool[] = [];
  private feel: FeelState = createFeel();
  private doorAnim = new Map<number, number>();
  private roofAlpha = new Map<number, number>();
  private flashBlind = 0;
  private flashHoldMs = 0;
  private lastSnap: Snapshot | null = null;
  private lobby: LobbyMsg | null = null;
  private welcome: WelcomeMsg | null = null;
  private phase: GamePhase = "connecting";
  private ping = 0;
  private raf = 0;
  private lastFrame = 0;
  private accum = 0;
  private listeners = new Set<HudListener>();
  private running = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private onResize = () => resizeCanvas(this.canvas);
  private lastHudKey = "";
  private hudClock = 0;
  private localFireCd = 0;
  private reloadUntil = 0;
  private ammoDrops: { id: number; x: number; y: number; amount: number }[] = [];
  private lastFoot = 0;
  private damageFlash = 0;
  private camZoom = 1;
  private camX = 0;
  private camY = 0;
  private prevVx = 0;
  private prevVy = 0;

  setMuted(m: boolean) {
    setMuted(m);
  }
  setVolume(v: number) {
    setMasterVolume(v);
  }
  getMuted() {
    return isMuted();
  }
  getVolume() {
    return getMasterVolume();
  }

  constructor(opts: { transport: Transport; canvas: HTMLCanvasElement; name: string }) {
    this.transport = opts.transport;
    this.canvas = opts.canvas;
    this.ctx = opts.canvas.getContext("2d")!;
    this.name = opts.name;
  }

  onHud(cb: HudListener) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(force = false) {
    const sec = this.lastSnap ? Math.ceil(this.lastSnap.matchLeftMs / 1000) : 0;
    const kills = this.lastSnap?.players.map((p) => `${p.id}:${p.kills}`).join(",") ?? "";
    const me = this.prediction.predicted ?? this.lastSnap?.players.find((p) => p.id === this.selfId);
    const hp = me?.hp ?? 100;
    const stamina = Math.round(me?.stamina ?? 100);
    const weapon = me?.weapon ?? 0;
    const mag = me?.mag ?? 0;
    const reserve = me?.reserve ?? 0;
    const key = `${this.phase}|${this.ping}|${sec}|${kills}|${hp}|${stamina}|${weapon}|${mag}|${reserve}|${this.lobby?.players.length ?? 0}`;
    if (!force && key === this.lastHudKey && this.phase === "playing") {
      if (performance.now() - this.hudClock < 250) return;
    }
    this.lastHudKey = key;
    this.hudClock = performance.now();

    const wpn = weaponOf(weapon);
    let reloadProgress = 0;
    // barra client: se fireCd alto após reloadStart recente — aproximação via last reload event
    if (this.reloadUntil > performance.now()) {
      const left = this.reloadUntil - performance.now();
      reloadProgress = 1 - left / wpn.reloadMs;
    }

    const hud: GameHud = {
      phase: this.phase,
      ping: this.ping,
      lobby: this.lobby,
      welcome: this.welcome,
      snapshot: this.lastSnap,
      selfHp: hp,
      stamina,
      weaponName: WEAPONS[weapon]?.name ?? "Pistola",
      mag,
      reserve,
      reloadProgress: Math.max(0, Math.min(1, reloadProgress)),
    };
    this.listeners.forEach((cb) => cb(hud));
  }

  async start() {
    resizeCanvas(this.canvas);
    initDecals(ARENA_W, ARENA_H);
    window.addEventListener("resize", this.onResize);
    this.input.attach(this.canvas);
    const unlock = () => {
      unlockAudio();
      window.removeEventListener("pointerdown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    void preloadSfx();
    void preloadArt().then(() => invalidateGroundCache());

    this.transport.on({
      onMessage: (data) => this.onMsg(data),
      onPeerJoin: () => {},
      onPeerLeave: () => {},
      onClose: () => {
        this.phase = "error";
        this.emit(true);
      },
    });

    await this.transport.connect();
    this.transport.send(encodeHello(this.name));
    this.phase = "lobby";
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
    this.pingTimer = setInterval(() => this.sendPing(), 1000);
    this.emit(true);
  }

  startMatch() {
    this.transport.send(encodeCtrl(MSG.START));
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    window.removeEventListener("resize", this.onResize);
    this.transport.close();
  }

  private sendPing() {
    this.transport.send(encodePing(performance.now()));
  }

  private onMsg(data: ArrayBuffer) {
    const type = msgType(data);
    if (type === MSG.WELCOME) {
      const w = decodeWelcome(data);
      if (w) {
        this.welcome = w;
        this.selfId = w.selfId;
        this.transport.selfId = String(w.selfId);
      }
      this.emit(true);
      return;
    }
    if (type === MSG.LOBBY) {
      this.lobby = decodeLobby(data);
      this.emit(true);
      return;
    }
    if (type === MSG.ROOM_FULL) {
      this.phase = "full";
      this.emit(true);
      return;
    }
    if (type === MSG.START) {
      this.phase = "playing";
      clearDecals();
      this.ammoDrops = [];
      resizeCanvas(this.canvas);
      this.emit(true);
      return;
    }
    if (type === MSG.PONG) {
      const t = decodePingTime(data);
      this.ping = Math.round(performance.now() - t);
      this.emit();
      return;
    }
    if (type === MSG.SNAPSHOT) {
      const snap = decodeSnapshot(data);
      if (!snap) return;
      this.lastSnap = snap;
      this.prediction.doorBits = snap.doorsBits ?? 0;
      this.prediction.serverTime = snap.serverTime;
      this.interp.push(snap);
      pushFlashesFromEvents(this.flashes, snap.events);
      pushFxFromEvents(this.fx, snap.events);
      processGoreEvents(snap.events, performance.now());
      const listener = {
        x: this.prediction.predicted?.x ?? 480,
        y: this.prediction.predicted?.y ?? 320,
      };
      for (const e of snap.events) {
        if (e.kind === "flash" && e.b === this.selfId) {
          this.flashBlind = 1;
          this.flashHoldMs = 400;
        }
        if (e.kind === "shot") {
          const self = e.a === this.selfId;
          pulseShotFeel(this.feel, e.weaponId ?? e.b, self);
          playWeaponShot(e.weaponId ?? e.b, e.x, e.y, listener);
          if (self) this.camZoom = 1.015;
        }
        if (e.kind === "reloadStart") {
          if (e.a === this.selfId) {
            this.reloadUntil = performance.now() + weaponOf(e.b).reloadMs;
          }
          playSfx("reload", e.x, e.y, listener);
        }
        if (e.kind === "doorOpen" || e.kind === "doorClose") {
          playSfx("door", e.x, e.y, listener);
        }
        if (e.kind === "explode" || e.kind === "fire") {
          playSfx("explosion", e.x, e.y, listener);
          if (e.kind === "explode") this.feel.shake = Math.max(this.feel.shake, 5);
        }
        if (e.kind === "hit" && e.b !== 255) {
          playSfx("hit_flesh", e.x, e.y, listener);
          if (e.b === this.selfId) this.damageFlash = 1;
        }
        if (e.kind === "hit" && e.b === 255) {
          stampBulletMark(e.x, e.y);
        }
        if (e.kind === "dropSpawn") {
          this.ammoDrops.push({ id: e.a, x: e.x, y: e.y, amount: e.b });
        }
        if (e.kind === "dropTaken") {
          this.ammoDrops = this.ammoDrops.filter((d) => d.id !== e.a);
          playSfx("pickup", e.x, e.y, listener);
        }
        if (e.kind === "death" && (e.weaponId ?? 0) === 100) {
          playSfx("explosion", e.x, e.y, listener);
        }
      }

      const me = snap.players.find((p) => p.id === this.selfId);
      if (me) {
        if (!this.prediction.predicted) this.prediction.reset(me);
        if (!this.smooth) this.smooth = createSmooth(me);
        const heldRaw = this.input.sample(this.worldFromScreen, me.x, me.y);
        const held: PlayerInput = {
          seq: this.seq,
          dx: heldRaw.dx,
          dy: heldRaw.dy,
          aim: heldRaw.aim,
          fire: heldRaw.fire,
          sprint: heldRaw.sprint,
          use: heldRaw.use,
          reload: heldRaw.reload,
          weapon: heldRaw.weapon,
          throw: heldRaw.throw,
          clientTime: performance.now(),
        };
        reconcile(me, this.prediction, this.smooth, held);
        if (this.prediction.predicted) {
          this.prediction.predicted.hp = me.hp;
          this.prediction.predicted.alive = me.alive;
          this.prediction.predicted.kills = me.kills;
          this.prediction.predicted.stamina = me.stamina;
          this.prediction.predicted.weapon = me.weapon;
          this.prediction.predicted.mag = me.mag;
          this.prediction.predicted.reserve = me.reserve;
          this.prediction.ammoBank[me.weapon] = { mag: me.mag, reserve: me.reserve };
          this.prediction.attachAmmo(this.prediction.predicted);
        }
      }

      if (snap.phase === 1) this.phase = "playing";
      if (snap.phase === 2) this.phase = "result";
      this.emit(snap.phase !== 1);
    }
  }

  private worldFromScreen = (sx: number, sy: number) => {
    const rect = this.canvas.getBoundingClientRect();
    const { scale, ox, oy, z } = cameraScreenLayout(rect.width, rect.height, this.camZoom || 1);
    return {
      x: this.camX + (sx - ox) / (scale * z),
      y: this.camY + (sy - oy) / (scale * z),
    };
  };

  private frame(now: number) {
    if (!this.running) return;
    const dtMs = Math.min(50, now - this.lastFrame);
    this.lastFrame = now;
    this.accum += dtMs;
    const dtSec = dtMs / 1000;

    if (this.phase === "playing" && this.selfId >= 0) {
      if (!this.prediction.predicted && this.lastSnap) {
        const me = this.lastSnap.players.find((p) => p.id === this.selfId);
        if (me) {
          this.prediction.reset(me);
          if (!this.smooth) this.smooth = createSmooth(me);
        }
      }

      const pred = this.prediction.predicted;
      const px = pred?.x ?? ARENA_W / 2;
      const py = pred?.y ?? ARENA_H / 2;
      const raw = this.input.sample(this.worldFromScreen, px, py);

      this.prediction.applyHeld(raw.dx, raw.dy, raw.aim, dtSec, raw.sprint, raw.weapon);

      this.localFireCd = Math.max(0, this.localFireCd - dtMs);
      if (raw.fire && this.localFireCd <= 0 && pred?.alive) {
        const wpn = WEAPONS[raw.weapon] ?? WEAPONS[0]!;
        if ((pred.mag ?? 0) <= 0) {
          this.localFireCd = 180;
          playSfx("empty_click", pred.x, pred.y, { x: pred.x, y: pred.y });
        } else {
          this.localFireCd = wpn.cooldownMs;
          if (this.prediction.predicted) {
            this.prediction.predicted.mag = Math.max(0, pred.mag - 1);
            this.prediction.ammoBank[raw.weapon] = {
              mag: this.prediction.predicted.mag,
              reserve: this.prediction.predicted.reserve,
            };
          }
          this.prediction.predictFire(raw.aim, raw.weapon);
          pulseShotFeel(this.feel, raw.weapon, true);
          this.camZoom = 1.015;
          const mx =
            pred.x + Math.cos(raw.aim) * wpn.muzzleForward - Math.sin(raw.aim) * wpn.muzzleSide;
          const my =
            pred.y + Math.sin(raw.aim) * wpn.muzzleForward + Math.cos(raw.aim) * wpn.muzzleSide;
          playWeaponShot(raw.weapon, mx, my, { x: pred.x, y: pred.y });
          pushFlashesFromEvents(this.flashes, [
            { kind: "shot", a: this.selfId, b: raw.weapon, x: mx, y: my, weaponId: raw.weapon },
          ]);
        }
      }

      const speed = Math.hypot(pred?.vx ?? 0, pred?.vy ?? 0);
      if (pred && speed > 25 && now - this.lastFoot > 280) {
        this.lastFoot = now;
        playFootstep(pred.x, pred.y, { x: pred.x, y: pred.y });
        spawnDust(pred.x, pred.y);
      }
      const dv = Math.hypot((pred?.vx ?? 0) - this.prevVx, (pred?.vy ?? 0) - this.prevVy);
      if (dv > 180 && pred) spawnDust(pred.x, pred.y);
      this.prevVx = pred?.vx ?? 0;
      this.prevVy = pred?.vy ?? 0;

      const stepMs = 1000 / INPUT_HZ;
      while (this.accum >= stepMs) {
        this.accum -= stepMs;
        const input: PlayerInput = {
          seq: this.seq++,
          dx: raw.dx,
          dy: raw.dy,
          aim: raw.aim,
          fire: raw.fire,
          sprint: raw.sprint,
          use: raw.use,
          reload: raw.reload,
          weapon: raw.weapon,
          throw: raw.throw,
          clientTime: performance.now(),
        };
        this.prediction.record(input);
        this.transport.send(encodeInput(input));
        if (this.accum > stepMs * 3) this.accum = 0;
      }
    } else {
      this.accum = 0;
    }

    this.flashes = tickFlashes(this.flashes, dtMs);
    this.fx = tickFx(this.fx, dtMs);
    tickGore(dtMs, now);
    this.camZoom += (1 - this.camZoom) * Math.min(1, dtMs / 80);
    this.damageFlash = Math.max(0, this.damageFlash - dtMs / 120);
    const origin = this.prediction.predicted
      ? {
          x: this.prediction.predicted.x,
          y: this.prediction.predicted.y,
          angle: this.prediction.predicted.angle,
        }
      : undefined;
    tickFeel(this.feel, dtMs, origin, stampShell);

    const bits = this.lastSnap?.doorsBits ?? 0;
    this.doorAnim = tickDoorAnim(this.doorAnim, bits, dtMs);
    const lx = this.prediction.predicted?.x ?? 0;
    const ly = this.prediction.predicted?.y ?? 0;
    this.roofAlpha = tickRoofAlpha(this.roofAlpha, lx, ly, dtMs);

    if (this.flashHoldMs > 0) {
      this.flashHoldMs = Math.max(0, this.flashHoldMs - dtMs);
      this.flashBlind = 1;
    } else if (this.flashBlind > 0) {
      this.flashBlind = Math.max(0, this.flashBlind - dtMs / 2400);
    }

    const remotes =
      this.lastSnap?.players
        .filter((p) => p.id !== this.selfId)
        .map((p) => this.interp.sample(p.id, now) ?? p) ?? [];

    let local: RenderView["local"] = null;
    if (this.prediction.predicted && this.smooth) {
      const vis = stepSmooth(this.smooth, this.prediction.predicted, dtMs);
      const pr = this.prediction.predicted;
      local = {
        x: vis.x,
        y: vis.y,
        angle: vis.angle,
        hp: pr.hp,
        alive: pr.alive,
        weapon: pr.weapon,
        stamina: pr.stamina,
        vx: pr.vx,
        vy: pr.vy,
      };
    } else if (this.lastSnap) {
      const me = this.lastSnap.players.find((p) => p.id === this.selfId);
      if (me) {
        local = {
          x: me.x,
          y: me.y,
          angle: me.angle,
          hp: me.hp,
          alive: me.alive,
          weapon: me.weapon,
          stamina: me.stamina,
          vx: me.vx,
          vy: me.vy,
        };
      }
    }

    const hostBullets = this.lastSnap?.bullets ?? [];
    const bullets = [...hostBullets, ...this.prediction.localBullets];

    const focusX = local?.x ?? ARENA_W / 2;
    const focusY = local?.y ?? ARENA_H / 2;
    const cam = computeCamera(focusX, focusY, this.camZoom);
    // trava no centro: sem lerp (personagem parado na tela, mapa desliza)
    this.camX = cam.camX;
    this.camY = cam.camY;

    const view: RenderView = {
      selfId: this.selfId,
      local,
      remotes,
      bullets,
      throwables: this.lastSnap?.throwables ?? [],
      flashes: this.flashes,
      fx: this.fx,
      flashBlind: this.flashBlind,
      events: this.lastSnap?.events ?? [],
      doorsBits: bits,
      feel: this.feel,
      doorAnim: this.doorAnim,
      roofAlpha: this.roofAlpha,
      ammoDrops: this.ammoDrops,
      camZoom: this.camZoom,
      camX: this.camX,
      camY: this.camY,
      damageFlash: this.damageFlash,
      hitFlashSelf: hitFlashActive(this.selfId, now),
      drawDecals: drawDecalLayer,
      drawGore: drawGoreActors,
    };

    try {
      if (this.phase === "playing" || this.phase === "result") {
        drawFrame(this.ctx, view, now);
      } else {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    } catch (err) {
      console.error("drawFrame", err);
    }

    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
}
