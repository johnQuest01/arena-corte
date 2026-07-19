/**
 * loop.ts — requestAnimationFrame + netcode (prediction / reconciliação / interp).
 */
import { abilityOf } from "../../../shared/abilities";
import { ARENA_H, ARENA_W, INPUT_HZ, MOVE_SPEED } from "../../../shared/constants";
import { WEAPONS, muzzlePoint, weaponOf } from "../../../shared/gear";
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
  clearAbilityFx,
  drawAbilityGround,
  drawAbilityWater,
  processAbilityEvents,
  spawnGiantExpireFx,
  spawnGiantHitFx,
  spawnGiantSummonFx,
  spawnWaterJetFx,
  spawnWaterSplash,
  tickAbilityFx,
} from "./abilities_fx";
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
  abilityName: string;
  abilityCd: number; // 0..1 remaining fraction (1 = ready)
  abilityCdMs: number;
  stunned: boolean;
  /** co-op */
  mode?: number;
  wave?: number;
  waveLeft?: number;
  playersAlive?: number;
  bossAlive?: boolean;
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
  /** flashUntil (serverTime) por jogador — snapshot não leva flashUntil */
  private flashUntilById = new Map<number, number>();
  private lastSnap: Snapshot | null = null;
  private lastSnapAt = 0;
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
  private weaponDrops: {
    id: number;
    x: number;
    y: number;
    weaponId: number;
    mag: number;
    reserve: number;
  }[] = [];
  private lastFoot = 0;
  private damageFlash = 0;
  private camZoom = 1;
  private camX = 0;
  private camY = 0;
  private prevVx = 0;
  private prevVy = 0;
  /** Q fica pendente até o input ser enviado ao host */
  private pendingCast = false;
  /** alvo travado por id do Gigante → { kind, id } */
  private giantTargets = new Map<number, { kind: 0 | 1 | 2; id: number }>();

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
    const key = `${this.phase}|${this.ping}|${sec}|${kills}|${hp}|${stamina}|${weapon}|${mag}|${reserve}|${this.lobby?.players.length ?? 0}|${this.lastSnap?.wave ?? 0}|${this.lastSnap?.waveLeft ?? 0}|${this.lastSnap?.enemies?.some((e) => e.type === 1) ? 1 : 0}`;
    if (!force && key === this.lastHudKey && this.phase === "playing") {
      if (performance.now() - this.hudClock < 250) return;
    }
    this.lastHudKey = key;
    this.hudClock = performance.now();

    const wpn = weaponOf(weapon);
    let reloadProgress = 0;
    if (this.reloadUntil > performance.now()) {
      const left = this.reloadUntil - performance.now();
      reloadProgress = 1 - left / wpn.reloadMs;
    }

    const ab = abilityOf(me?.ability ?? 0);
    const nowSrv = this.lastSnap?.serverTime ?? 0;
    const cdUntil = me?.abilityCdUntil ?? 0;
    const cdLeft = Math.max(0, cdUntil - nowSrv);
    const abilityCd = cdLeft <= 0 ? 1 : 1 - Math.min(1, cdLeft / ab.cooldownMs);
    const stunned = (me?.stunnedUntil ?? 0) > nowSrv;

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
      abilityName: ab.name,
      abilityCd,
      abilityCdMs: ab.cooldownMs,
      stunned,
      mode: this.lastSnap?.mode ?? this.lobby?.mode ?? this.welcome?.mode ?? 0,
      wave: this.lastSnap?.wave ?? 0,
      waveLeft: this.lastSnap?.waveLeft ?? 0,
      playersAlive: this.lastSnap?.players.filter((p) => p.alive).length ?? 0,
      bossAlive: this.lastSnap?.enemies?.some((e) => e.type === 1) ?? false,
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

  /** API dos controles touch / HUD mobile */
  readonly controls = {
    setTouchUi: (on: boolean) => this.input.setTouchUi(on),
    setMove: (x: number, y: number, active: boolean) => this.input.setVirtualMove(x, y, active),
    setAim: (x: number, y: number, active: boolean, firing: boolean) =>
      this.input.setVirtualAim(x, y, active, firing),
    setSprint: (on: boolean) => this.input.setVirtualSprint(on),
    cast: () => this.input.pulseCast(),
    reload: () => this.input.pulseReload(),
    use: () => this.input.pulseUse(),
    toggleAbility: () => this.input.toggleAbility(),
    setWeapon: (id: number) => this.input.setWeaponSlot(id),
    cycleWeapon: (dir: 1 | -1) => this.input.cycleWeapon(dir),
    getWeapon: () => this.input.weapon,
  };

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
      this.weaponDrops = [];
      clearAbilityFx();
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
      this.lastSnapAt = performance.now();
      this.prediction.doorBits = snap.doorsBits ?? 0;
      this.prediction.serverTime = snap.serverTime;
      this.interp.push(snap);
      pushFlashesFromEvents(this.flashes, snap.events);
      pushFxFromEvents(this.fx, snap.events);
      processGoreEvents(snap.events, performance.now(), this.selfId);
      const listener = {
        x: this.prediction.predicted?.x ?? 480,
        y: this.prediction.predicted?.y ?? 320,
      };
      for (const e of snap.events) {
        if (e.kind === "flash") {
          const until = snap.serverTime + 2800;
          this.flashUntilById.set(e.b, until);
          if (e.b === this.selfId) {
            this.flashBlind = 1;
            this.flashHoldMs = 400;
            if (this.prediction.predicted) {
              (this.prediction.predicted as { flashUntil?: number }).flashUntil = until;
            }
          }
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
        if (e.kind === "enemyDeath") {
          // gore por tipo (b = type)
          processGoreEvents(
            [{ kind: "death", a: 255, b: e.a, x: e.x, y: e.y, weaponId: e.b === 1 ? 100 : 0 }],
            performance.now(),
            this.selfId,
          );
          playSfx("hit_flesh", e.x, e.y, listener);
          if (e.b === 1) this.feel.shake = Math.max(this.feel.shake, 4);
        }
        if (e.kind === "enemyHit" && e.b === 1) {
          // passos/impacto do brutamontes perto
          const me = this.prediction.predicted;
          if (me && Math.hypot(me.x - e.x, me.y - e.y) < 280) {
            this.feel.shake = Math.max(this.feel.shake, 1.2);
          }
        }
        if (e.kind === "enemySpawn" && e.b === 1) {
          this.feel.shake = Math.max(this.feel.shake, 2);
        }
        if (e.kind === "dropSpawn") {
          this.ammoDrops.push({ id: e.a, x: e.x, y: e.y, amount: e.b });
        }
        if (e.kind === "dropTaken") {
          this.ammoDrops = this.ammoDrops.filter((d) => d.id !== e.a);
          playSfx("pickup", e.x, e.y, listener);
        }
        if (e.kind === "weaponDropSpawn") {
          const packed = e.weaponId ?? 0;
          this.weaponDrops.push({
            id: e.a,
            x: e.x,
            y: e.y,
            weaponId: e.b,
            mag: packed & 0xff,
            reserve: (packed >> 8) & 0xff,
          });
        }
        if (e.kind === "weaponDropTaken") {
          const drop = this.weaponDrops.find((d) => d.id === e.a);
          this.weaponDrops = this.weaponDrops.filter((d) => d.id !== e.a);
          playSfx("pickup", e.x, e.y, listener);
          if (drop && e.b === this.selfId) {
            this.prediction.applyWeaponLoot(drop.weaponId, drop.mag, drop.reserve);
          }
        }
        if (e.kind === "ability") {
          const hitId = e.weaponId ?? 0;
          // impacto em alvo específico (knockback real)
          if (hitId >= 1000) {
            spawnWaterSplash(e.x, e.y);
            playSfx("splash", e.x, e.y, listener);
            // vítima local: aplica impulso do host na predição (online)
            const victimId = hitId - 1000;
            if (victimId === this.selfId && this.prediction.predicted) {
              const me = snap.players.find((p) => p.id === this.selfId);
              if (me) {
                this.prediction.predicted.vx = me.vx;
                this.prediction.predicted.vy = me.vy;
                this.prediction.predicted.x = me.x;
                this.prediction.predicted.y = me.y;
                this.prediction.predicted.stunnedUntil = me.stunnedUntil;
              }
            }
          } else if (e.a !== this.selfId) {
            // conjuro remoto
            processAbilityEvents([e], this.feel, this.selfId, (x, y) => {
              if (e.b === 0) playSfx("water_whoosh", x, y, listener);
              else playSfx("explosion", x, y, listener);
            });
          }
        }
        if (e.kind === "giantSpawn") {
          const packed = e.weaponId ?? 0;
          this.giantTargets.set(e.a, {
            kind: ((packed >> 8) & 3) as 0 | 1 | 2,
            id: packed & 0xff,
          });
          // Conjurador já tem FX predito; peers/bots veem o evento do host
          if (e.b !== this.selfId) {
            spawnGiantSummonFx(e.x, e.y);
            playSfx("explosion", e.x, e.y, listener);
            const dist = Math.hypot(e.x - listener.x, e.y - listener.y);
            if (dist < 520) {
              this.feel.shake = Math.max(this.feel.shake, 1.1 * (1 - dist / 520));
            }
          }
        }
        if (e.kind === "giantHit") {
          this.giantTargets.delete(e.a);
          spawnGiantHitFx(e.x, e.y);
          playSfx("hit_flesh", e.x, e.y, listener);
          playSfx("explosion", e.x, e.y, listener);
          const dist = Math.hypot(e.x - listener.x, e.y - listener.y);
          if (dist < 640) {
            const fall = 1 - dist / 640;
            this.feel.shake = Math.max(this.feel.shake, 2.8 * fall);
            this.feel.bodyKick = Math.max(this.feel.bodyKick, fall);
          }
          // sync vítima local: death com killer no evento, OU weaponId com player id
          const packed = e.weaponId ?? 0;
          const maybeVictim = packed & 0xff;
          const kindBits = (packed >> 8) & 3;
          if (
            kindBits === 0 &&
            maybeVictim === this.selfId &&
            this.prediction.predicted
          ) {
            const me = snap.players.find((p) => p.id === this.selfId);
            if (me) {
              this.prediction.predicted.vx = me.vx;
              this.prediction.predicted.vy = me.vy;
              this.prediction.predicted.x = me.x;
              this.prediction.predicted.y = me.y;
              this.prediction.predicted.alive = me.alive;
              this.prediction.predicted.hp = me.hp;
            }
          }
        }
        if (e.kind === "giantExpire") {
          this.giantTargets.delete(e.a);
          spawnGiantExpireFx(e.x, e.y);
          playSfx("empty_click", e.x, e.y, listener);
        }
        // morte por Gigante: sync posição do cadáver pra vítima local
        if (e.kind === "death" && e.b === this.selfId && this.prediction.predicted) {
          const me = snap.players.find((p) => p.id === this.selfId);
          if (me) {
            this.prediction.predicted.x = me.x;
            this.prediction.predicted.y = me.y;
            this.prediction.predicted.vx = me.vx;
            this.prediction.predicted.vy = me.vy;
            this.prediction.predicted.alive = me.alive;
            this.prediction.predicted.hp = me.hp;
          }
        }
        if (e.kind === "death" && (e.weaponId ?? 0) === 100) {
          playSfx("explosion", e.x, e.y, listener);
        }
      }

      const me = snap.players.find((p) => p.id === this.selfId);
      if (me) {
        if (!this.prediction.predicted) this.prediction.reset(me);
        if (!this.smooth) this.smooth = createSmooth(me);
        // peek: NÃO consumir Q/R — sample() no snap comia o cast antes do frame
        const heldRaw = this.input.peek(this.worldFromScreen, me.x, me.y);
        const held: PlayerInput = {
          seq: this.seq,
          dx: heldRaw.dx,
          dy: heldRaw.dy,
          aim: heldRaw.aim,
          fire: heldRaw.fire,
          sprint: heldRaw.sprint,
          use: heldRaw.use,
          reload: heldRaw.reload,
          cast: heldRaw.cast,
          weapon: heldRaw.weapon,
          throw: heldRaw.throw,
          ability: heldRaw.ability,
          clientTime: performance.now(),
        };
        if (this.prediction.predicted) {
          this.prediction.predicted.ability = heldRaw.ability;
        }
        reconcile(me, this.prediction, this.smooth, held);
        if (this.prediction.predicted) {
          this.prediction.predicted.hp = me.hp;
          this.prediction.predicted.alive = me.alive;
          this.prediction.predicted.kills = me.kills;
          this.prediction.predicted.stamina = me.stamina;
          this.prediction.predicted.weapon = me.weapon;
          this.prediction.predicted.mag = me.mag;
          this.prediction.predicted.reserve = me.reserve;
          this.prediction.predicted.ability = me.ability;
          this.prediction.predicted.abilityCdUntil = me.abilityCdUntil;
          this.prediction.predicted.stunnedUntil = me.stunnedUntil;
          this.prediction.predicted.vx = me.vx;
          this.prediction.predicted.vy = me.vy;
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

      // tempo de servidor estimado (stun/flash não ficam presos entre snaps)
      const nowSrv =
        (this.lastSnap?.serverTime ?? 0) +
        Math.max(0, performance.now() - (this.lastSnapAt || performance.now()));
      const stunned = !!pred && (pred.stunnedUntil ?? 0) > nowSrv;
      const flashed =
        !!pred &&
        ((this.flashUntilById.get(this.selfId) ?? 0) > nowSrv ||
          ((pred as { flashUntil?: number }).flashUntil ?? 0) > nowSrv);

      this.localFireCd = Math.max(0, Math.min(2000, this.localFireCd - dtMs));
      const snapMag =
        this.lastSnap?.players.find((p) => p.id === this.selfId)?.mag ?? pred?.mag ?? 0;
      const magNow = Math.max(pred?.mag ?? 0, snapMag);
      // reload local visual: não bloqueia envio de fire pro host
      const reloadingLocal = this.reloadUntil > performance.now() && magNow <= 0;
      if (raw.fire && !stunned && !flashed && this.localFireCd <= 0 && pred?.alive) {
        const wpn = WEAPONS[raw.weapon] ?? WEAPONS[0]!;
        if (magNow <= 0 || reloadingLocal) {
          this.localFireCd = 100;
          if (magNow <= 0) {
            playSfx("empty_click", pred.x, pred.y, { x: pred.x, y: pred.y });
          }
        } else {
          this.localFireCd = Math.max(40, wpn.cooldownMs);
          if (this.prediction.predicted) {
            this.prediction.predicted.mag = Math.max(0, (pred.mag ?? magNow) - 1);
            this.prediction.ammoBank[raw.weapon] = {
              mag: this.prediction.predicted.mag,
              reserve: this.prediction.predicted.reserve,
            };
          }
          this.prediction.predictFire(raw.aim, raw.weapon);
          pulseShotFeel(this.feel, raw.weapon, true);
          this.camZoom = 1.015;
          const muzz = muzzlePoint(pred.x, pred.y, raw.aim, wpn);
          playWeaponShot(raw.weapon, muzz.x, muzz.y, { x: pred.x, y: pred.y });
          pushFlashesFromEvents(this.flashes, [
            {
              kind: "shot",
              a: this.selfId,
              b: raw.weapon,
              x: muzz.x,
              y: muzz.y,
              weaponId: raw.weapon,
            },
          ]);
        }
      }

      // predição local de habilidade (FX + CD — entidade vem do host)
      if (raw.cast) this.pendingCast = true;
      if (this.pendingCast && pred?.alive && !stunned && !flashed) {
        pred.ability = raw.ability ?? pred.ability ?? 0;
        const ab = abilityOf(pred.ability ?? 0);
        const cdUntil = pred.abilityCdUntil ?? 0;
        if (cdUntil <= nowSrv) {
          if (raw.cast) {
            pred.abilityCdUntil = nowSrv + ab.cooldownMs;
            if (ab.id === 0) {
              spawnWaterJetFx(pred.x, pred.y, raw.aim);
              this.feel.bodyKick = Math.max(this.feel.bodyKick, 0.7);
              this.feel.shake = Math.max(this.feel.shake, 1.2);
              playSfx("water_whoosh", pred.x, pred.y, { x: pred.x, y: pred.y });
            } else if (ab.id === 1) {
              spawnGiantSummonFx(
                pred.x + Math.cos(raw.aim) * 28,
                pred.y + Math.sin(raw.aim) * 28,
              );
              this.feel.shake = Math.max(this.feel.shake, 1.3);
              playSfx("explosion", pred.x, pred.y, { x: pred.x, y: pred.y });
            }
          }
        }
      }

      const speed = Math.hypot(raw.dx, raw.dy) > 0.15 ? MOVE_SPEED * (raw.sprint ? 1.35 : 1) : 0;
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
      // garante envio do Q mesmo se o accum ainda não completou um tick
      if (this.pendingCast && this.accum < stepMs) this.accum = stepMs;
      while (this.accum >= stepMs) {
        this.accum -= stepMs;
        const sendCast = this.pendingCast;
        const input: PlayerInput = {
          seq: this.seq++,
          dx: raw.dx,
          dy: raw.dy,
          aim: raw.aim,
          fire: raw.fire,
          sprint: raw.sprint,
          use: raw.use,
          reload: raw.reload,
          cast: sendCast,
          weapon: raw.weapon,
          throw: raw.throw,
          ability: raw.ability,
          clientTime: performance.now(),
        };
        if (sendCast) this.pendingCast = false;
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
    tickAbilityFx(dtMs);
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

    // passos do Brutamontes perto do player
    if (origin && this.lastSnap?.enemies) {
      for (const en of this.lastSnap.enemies) {
        if (en.type !== 1) continue;
        const d = Math.hypot(en.x - origin.x, en.y - origin.y);
        if (d < 320 && (en.state === 5 || en.state === 4 || en.state === 1)) {
          const amp = en.state === 5 ? 2.2 : en.state === 4 ? 1.4 : 0.55;
          this.feel.shake = Math.max(this.feel.shake, amp * (1 - d / 320));
        }
      }
    }

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

    // limpa flashes expirados
    const srvNow = this.lastSnap?.serverTime ?? 0;
    for (const [id, until] of this.flashUntilById) {
      if (until <= srvNow) this.flashUntilById.delete(id);
    }

    const remotes =
      this.lastSnap?.players
        .filter((p) => p.id !== this.selfId)
        .map((p) => {
          const sample = this.interp.sample(p.id, now) ?? p;
          return {
            ...sample,
            flashUntil: this.flashUntilById.get(p.id) ?? 0,
          };
        }) ?? [];

    let reloadProgress = 0;
    if (this.reloadUntil > performance.now()) {
      const meWpn = weaponOf(
        this.prediction.predicted?.weapon ??
          this.lastSnap?.players.find((p) => p.id === this.selfId)?.weapon ??
          0,
      );
      reloadProgress = Math.max(
        0,
        Math.min(1, 1 - (this.reloadUntil - performance.now()) / meWpn.reloadMs),
      );
    }

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
        reloadProgress,
        stunnedUntil: pr.stunnedUntil ?? 0,
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
          reloadProgress,
          stunnedUntil: me.stunnedUntil ?? 0,
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

    // limpa alvos de Gigantes que já sumiram do snapshot
    const liveEnemies = this.lastSnap?.enemies ?? [];
    for (const gid of [...this.giantTargets.keys()]) {
      if (!liveEnemies.some((e) => e.id === gid && e.type === 2)) {
        this.giantTargets.delete(gid);
      }
    }
    // micro-tremor se Gigante perto do player
    if (local?.alive) {
      for (const en of liveEnemies) {
        if (en.type !== 2) continue;
        const d = Math.hypot(en.x - local.x, en.y - local.y);
        if (d < 120) {
          this.feel.shake = Math.max(this.feel.shake, 0.35 * (1 - d / 120));
        }
      }
    }

    const view: RenderView = {
      selfId: this.selfId,
      local,
      remotes,
      enemies: liveEnemies,
      giantTargets: this.giantTargets,
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
      weaponDrops: this.weaponDrops,
      camZoom: this.camZoom,
      camX: this.camX,
      camY: this.camY,
      damageFlash: this.damageFlash,
      hitFlashSelf: hitFlashActive(this.selfId, now),
      drawDecals: drawDecalLayer,
      drawGore: drawGoreActors,
      drawAbilityGround,
      drawAbilityWater,
      serverTime: this.lastSnap?.serverTime ?? 0,
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
