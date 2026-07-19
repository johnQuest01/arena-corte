/**
 * loop.ts — requestAnimationFrame + netcode (prediction / reconciliação / interp).
 */
import { ARENA_H, ARENA_W, INPUT_HZ } from "../../../shared/constants";
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
import { InputController } from "./input";
import { WEAPONS } from "../../../shared/gear";
import {
  drawFrame,
  pushFlashesFromEvents,
  pushFxFromEvents,
  resizeCanvas,
  tickFlashes,
  tickFx,
  type FxPool,
  type MuzzleFlash,
  type RenderView,
} from "./render";
import { preloadKenneySprites } from "./sprites";

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
  /** 0..1 — intensidade da tela branca (flashbang). */
  private flashBlind = 0;
  /** ms com branco total antes de começar a recuperar a visão. */
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
  /** Evita setState a cada snapshot (apagava o canvas via re-render React). */
  private lastHudKey = "";
  private hudClock = 0;

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
    const key = `${this.phase}|${this.ping}|${sec}|${kills}|${hp}|${stamina}|${weapon}|${this.lobby?.players.length ?? 0}`;
    if (!force && key === this.lastHudKey && this.phase === "playing") {
      if (performance.now() - this.hudClock < 250) return;
    }
    this.lastHudKey = key;
    this.hudClock = performance.now();

    const hud: GameHud = {
      phase: this.phase,
      ping: this.ping,
      lobby: this.lobby,
      welcome: this.welcome,
      snapshot: this.lastSnap,
      selfHp: hp,
      stamina,
      weaponName: WEAPONS[weapon]?.name ?? "Pistola",
    };
    this.listeners.forEach((cb) => cb(hud));
  }

  async start() {
    resizeCanvas(this.canvas);
    window.addEventListener("resize", this.onResize);
    this.input.attach(this.canvas);
    void preloadKenneySprites(); // Kenney CC0 — informations.MD

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
      this.interp.push(snap);
      pushFlashesFromEvents(this.flashes, snap.events);
      pushFxFromEvents(this.fx, snap.events);
      for (const e of snap.events) {
        // flash na SUA tela: evento com b = seu id
        if (e.kind === "flash" && e.b === this.selfId) {
          this.flashBlind = 1;
          this.flashHoldMs = 400; // branco total ~0,4s, depois recupera
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
        }
      }

      if (snap.phase === 1) this.phase = "playing";
      if (snap.phase === 2) this.phase = "result";
      this.emit(snap.phase !== 1);
    }
  }

  private worldFromScreen = (sx: number, sy: number) => {
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / ARENA_W, rect.height / ARENA_H);
    const ox = (rect.width - ARENA_W * scale) / 2;
    const oy = (rect.height - ARENA_H * scale) / 2;
    return {
      x: (sx - ox) / scale,
      y: (sy - oy) / scale,
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

      this.prediction.applyHeld(
        raw.dx,
        raw.dy,
        raw.aim,
        dtSec,
        raw.sprint,
        raw.weapon,
      );

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
    // flashbang: branco total → volta a visão (curva suave, tipo “print” sumindo)
    if (this.flashHoldMs > 0) {
      this.flashHoldMs = Math.max(0, this.flashHoldMs - dtMs);
      this.flashBlind = 1;
    } else if (this.flashBlind > 0) {
      // ~2,4s pra zerar; ease-out (fica branco mais tempo no começo)
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

    const view: RenderView = {
      selfId: this.selfId,
      local,
      remotes,
      bullets: this.lastSnap?.bullets ?? [],
      throwables: this.lastSnap?.throwables ?? [],
      flashes: this.flashes,
      fx: this.fx,
      flashBlind: this.flashBlind,
      events: this.lastSnap?.events ?? [],
    };

    try {
      if (this.phase === "playing" || this.phase === "result") {
        drawFrame(this.ctx, view, now);
      } else {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.fillStyle = "#0a0e0c";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
    } catch (err) {
      console.error("drawFrame", err);
    }

    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
}
