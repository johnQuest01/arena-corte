/**
 * loop.ts — requestAnimationFrame + netcode (prediction / reconciliação / interp).
 */
import { isTouchPrimary } from "./fullscreen";
import { BODY_K } from "./character";
import {
  abilityOf,
  CHAIN_SEGMENT_BASE,
  performBlink,
  SHIELD_THROW_KIND,
  DASH_BURST_DT,
  DASH_MAX_CHARGES,
  DASH_RECHARGE_MS,
  performRecoilDash,
  resolveTotemBody,
  SHIELD_MS,
  SPRINT_BOOTS_DURATION_MS,
  tryAutoRecoilCape,
  TOTEM_RADIUS,
} from "../../../shared/abilities";
import { ARENA_H, ARENA_W, INPUT_HZ, MOVE_SPEED, PLAYER_R } from "../../../shared/constants";
import { GUN_HAND_BODY_Y, WEAPONS, muzzlePoint, weaponOf } from "../../../shared/gear";
import { hitsSolid, moveAndSlide } from "../../../shared/map";
import {
  BOOTS,
  CAPES,
  HAIR_COLORS,
  HELMETS,
  OUTFITS,
  SKIN_TONES,
  autoLookFor,
  decodeLook,
  encodeLook,
  type Look,
} from "../../../shared/cosmetics";
import {
  MSG,
  decodeLobby,
  decodePingTime,
  decodeSnapshot,
  decodeWelcome,
  encodeHello,
  encodeInput,
  encodeLookMsg,
  encodePing,
  encodeCtrl,
  msgType,
  type LobbyMsg,
  type PlayerInput,
  type Snapshot,
  type SpikeTotemSnap,
  type TickEvent,
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
import { loadMyLook } from "./lookStore";
import { pruneCapes } from "./capes";
import { prewarmWorld } from "./world";
import { SPAWNS } from "../../../shared/constants";
import { spawnShieldSparks, tickShieldSparks } from "./shield";
import {
  clearPowersFx,
  spawnBlinkFx,
  spawnCastSparkle,
  spawnLightningBolt,
  tickPowersFx,
} from "./powers_fx";
import {
  clearAbilityFx,
  drawAbilityGround,
  drawAbilityWater,
  processAbilityEvents,
  beginRiftSink,
  processRiftEvents,
  drawSpikeTotems,
  drawTotemAimBeam,
  drawTotemHoloDissolves,
  spawnBigBoomFx,
  spawnBombDropFx,
  spawnGiantExpireFx,
  spawnGiantHitFx,
  spawnGiantSummonFx,
  spawnRiftStompFx,
  spawnTotemExpireFx,
  spawnTotemHitFx,
  spawnTotemSpawnFx,
  spawnWaterJetFx,
  spawnWaterSplash,
  spawnFrostCastFx,
  spawnFrostFreezeFx,
  syncFrostShatter,
  tickAbilityFx,
} from "./abilities_fx";
import {
  CAST_RGB_DISC,
  CAST_RGB_VOLT,
  clearFx2,
  drawSpikeTotems2,
  drawTotemAim2,
  spawnBigBoom2,
  spawnBlink2,
  spawnBolt2,
  spawnBombDrop2,
  spawnBootsCast2,
  spawnCastGlint2,
  spawnDiscBounce2,
  spawnDiscCatch2,
  spawnFreeze2,
  spawnFrost2,
  spawnGiantExpire2,
  spawnGiantHit2,
  spawnGiantSummon2,
  spawnRiftStomp2,
  spawnShadowBurst2,
  spawnShatter2,
  spawnShieldCast2,
  spawnShieldRipple2,
  spawnTotem2,
  spawnTotemExpire2,
  spawnTotemHit2,
  spawnWaterJet2,
  spawnWaterSplash2,
  tickAuras2,
  tickFx2,
  type AuraActor,
} from "./fx2";
import {
  clearFxOwners,
  frostIsOld,
  fxOld,
  setFrostCaster,
  setFxStyleProvider,
  setGiantOwner,
  setTotemOwner,
  totemAngleOf,
  totemOwnerOf,
} from "./fxstyle";
import { applyGraphicsQuality, getGraphicsQuality, setGraphicsQuality as persistGraphics, type GraphicsQuality } from "./graphics";
import { previewTotemPlant } from "./input";
import {
  clearDecals,
  drawDecalLayer,
  drawGoreActors,
  hitFlashActive,
  initDecals,
  processGoreEvents,
  setCorpseColorProvider,
  spawnDust,
  spawnGiantStepDust,
  stampBulletMark,
  stampShell,
  tickGore,
} from "./gore";
import {
  HITMARKER_MS,
  pruneDmgArrows,
  pruneKillFeed,
  pushKillFeed,
  type DmgArrow,
  type KillFeedEntry,
} from "./feedback";
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

/** Conjuro de outro jogador com visual novo (o som/tremor vem de processAbilityEvents). */
function spawnRemoteCast2(e: TickEvent) {
  const ang = e.angle ?? 0;
  if (e.b === 0) spawnWaterJet2(e.x, e.y, ang);
  else if (e.b === 2) spawnBootsCast2(e.x, e.y);
  else if (e.b === 4) spawnShieldCast2(e.x, e.y, ang);
  else if (e.b === 5) spawnRiftStomp2(e.x, e.y);
  else if (e.b === 6) spawnBombDrop2(e.x, e.y);
  else if (e.b === 8) spawnFrost2(e.x, e.y, ang);
  // 1 (Gigante) vem no giantSpawn; 3 (Capa) sai da aura; 7 (Totem) no totemSpawn
}

/** Totens de cada dono no estilo dele (Novo = cristais, Rascunho = C neon). */
function drawTotemsByStyle(ctx: CanvasRenderingContext2D, totems: readonly SpikeTotemSnap[], tMs: number) {
  const oldT = totems.filter((t) => fxOld(t.ownerId));
  if (oldT.length) drawSpikeTotems(ctx, oldT, tMs);
  if (oldT.length < totems.length) drawSpikeTotems2(ctx, totems.filter((t) => !fxOld(t.ownerId)), tMs);
}

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
  /** id da habilidade equipada (ícone no HUD) */
  abilityId?: number;
  abilityCd: number; // 0..1 remaining fraction (1 = ready)
  abilityCdMs: number;
  /** Capa de Recuo: cargas atuais */
  dashCharges?: number;
  /** 0..1 progresso da próxima carga (1 = pronta / cheia) */
  dashRecharge?: number;
  stunned: boolean;
  /** congelado (bloco de gelo — trava tudo) */
  frozen?: boolean;
  /** co-op */
  mode?: number;
  wave?: number;
  waveLeft?: number;
  playersAlive?: number;
  bossAlive?: boolean;
  error?: string;
  /** kill feed vivo (client-only) */
  killFeed?: KillFeedEntry[];
  /** agora (ms) pra fade no HUD */
  nowMs?: number;
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
  private lastEmptyClickAt = 0;
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
  private abilityDrops: { id: number; x: number; y: number; abilityId: number }[] = [];
  private lastFoot = 0;
  private damageFlash = 0;
  private killFeed: KillFeedEntry[] = [];
  private dmgArrows: DmgArrow[] = [];
  private hitMarkerUntil = 0;
  /**
   * Zoom base: o boneco ficou menor no mundo (proporção com casas/carros);
   * aproxima um pouco a câmera pra ele continuar legível — mais no celular.
   */
  private baseZoom = isTouchPrimary() ? 1.25 : 1.12;
  private camZoom = this.baseZoom;
  private camX = 0;
  private camY = 0;
  private prevVx = 0;
  private prevVy = 0;
  /** Q fica pendente até o input ser enviado ao host */
  private pendingCast = false;
  /** alvo travado por id do Gigante → { kind, id } */
  private giantTargets = new Map<number, { kind: 0 | 1 | 2; id: number }>();
  /** juice client-side do Gigante (passos / windup / massa) */
  private giantBobPrev = new Map<number, number>();
  private giantStatePrev = new Map<number, number>();
  private giantPosPrev = new Map<number, { x: number; y: number }>();
  private giantWindupAt = new Map<number, number>();
  private giantVis = new Map<number, { facing: number; skew: number; windupFlash: number }>();
  /** visual (cosméticos) de cada jogador — vem do LOBBY */
  private looks = new Map<number, Look>();
  private myLook: Look = loadMyLook();
  private names = new Map<number, string>();
  private lastCapePrune = 0;
  private worldWarm = false;
  private readonly lookFor = (id: number): Look =>
    id === this.selfId ? this.myLook : this.looks.get(id) ?? autoLookFor(id);
  private readonly nameFor = (id: number): string | undefined => this.names.get(id);

  /** Quem veste a capa Sombria (visual novo) solta uma explosão de sombra ao conjurar. */
  private darkCastFx(id: number, x: number, y: number) {
    if (fxOld(id)) return;
    const lk = this.lookFor(id);
    if (lk.body !== 0 || CAPES[lk.cape]?.style !== "dark") return;
    spawnShadowBurst2(x, y);
  }

  setMuted(m: boolean) {
    setMuted(m);
  }
  setVolume(v: number) {
    setMasterVolume(v);
  }
  /** Troca o visual (guarda-roupa) — avisa o host, que repassa pra sala. */
  setLook(look: Look) {
    this.myLook = look;
    if (this.selfId >= 0) this.looks.set(this.selfId, look);
    if (this.running) this.transport.send(encodeLookMsg(encodeLook(look)));
  }
  getLook(): Look {
    return this.myLook;
  }
  /** Troca Leve/Full e reaplica cache/DPR na hora. */
  setGraphicsQuality(q: GraphicsQuality) {
    persistGraphics(q);
    resizeCanvas(this.canvas);
  }
  getGraphicsQuality(): GraphicsQuality {
    return getGraphicsQuality();
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
    // gancho de teste (só no `npm run dev`): posição do jogador na tela
    if (import.meta.env.DEV) {
      (window as unknown as { __arenaClient?: GameClient }).__arenaClient = this;
    }
  }

  /** DEV: posição (px CSS, relativa ao canvas) do próprio jogador. */
  debugSelfScreen(): { x: number; y: number; scale: number } | null {
    const me = this.prediction.predicted;
    if (!me) return null;
    const rect = this.canvas.getBoundingClientRect();
    const { scale, ox, oy, z } = cameraScreenLayout(rect.width, rect.height, this.camZoom || 1);
    return {
      x: rect.left + ox + (me.x - this.camX) * scale * z,
      y: rect.top + oy + (me.y - this.camY) * scale * z,
      scale: scale * z,
    };
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
    const lobbyKey = this.lobby
      ? `${this.lobby.players.length}:${this.lobby.canStart ? 1 : 0}:${this.lobby.hostId}:${this.lobby.players.map((p) => p.id).join(",")}`
      : "0";
    const feedKey = this.killFeed.map((k) => k.id).join(",");
    const feedTick = this.killFeed.length ? Math.floor(performance.now() / 120) : 0;
    const abEarly = abilityOf(me?.ability ?? 0);
    const nowSrvEarly = this.lastSnap?.serverTime ?? 0;
    const dashChargesKey = me?.dashCharges ?? DASH_MAX_CHARGES;
    const dashRechargeLeftKey = Math.max(0, (me?.dashRechargeAt ?? 0) - nowSrvEarly);
    const key = `${this.phase}|${this.ping}|${sec}|${kills}|${hp}|${stamina}|${weapon}|${mag}|${reserve}|${lobbyKey}|${feedKey}|${feedTick}|${this.lastSnap?.wave ?? 0}|${this.lastSnap?.waveLeft ?? 0}|${this.lastSnap?.enemies?.some((e) => e.type === 1) ? 1 : 0}|${me?.ability ?? 0}|${dashChargesKey}|${Math.floor(dashRechargeLeftKey / 200)}|${abEarly.id}`;
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
    let abilityCd = cdLeft <= 0 ? 1 : 1 - Math.min(1, cdLeft / Math.max(1, ab.cooldownMs));
    let dashCharges = me?.dashCharges ?? DASH_MAX_CHARGES;
    let dashRecharge = 1;
    if (ab.id === 3) {
      dashCharges = me?.dashCharges ?? DASH_MAX_CHARGES;
      const reAt = me?.dashRechargeAt ?? 0;
      if (dashCharges >= DASH_MAX_CHARGES) {
        dashRecharge = 1;
        abilityCd = 1;
      } else if (reAt > nowSrv) {
        const left = reAt - nowSrv;
        dashRecharge = 1 - Math.min(1, left / DASH_RECHARGE_MS);
        abilityCd = dashCharges > 0 ? 1 : dashRecharge;
      } else {
        dashRecharge = 1;
        abilityCd = 1;
      }
    }
    const stunned = (me?.stunnedUntil ?? 0) > nowSrv;
    const frozen = (me?.frozenUntil ?? 0) > nowSrv;

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
      abilityId: ab.id,
      abilityCd,
      abilityCdMs: ab.id === 3 ? DASH_RECHARGE_MS : ab.cooldownMs,
      dashCharges,
      dashRecharge,
      stunned,
      frozen,
      mode: this.lastSnap?.mode ?? this.lobby?.mode ?? this.welcome?.mode ?? 0,
      wave: this.lastSnap?.wave ?? 0,
      waveLeft: this.lastSnap?.waveLeft ?? 0,
      playersAlive: this.lastSnap?.players.filter((p) => p.alive).length ?? 0,
      bossAlive: this.lastSnap?.enemies?.some((e) => e.type === 1) ?? false,
      killFeed: this.killFeed,
      nowMs: performance.now(),
    };
    this.listeners.forEach((cb) => cb(hud));
  }

  async start() {
    // Preferência do usuário (Leve/Full) — padrão no touch é Leve
    applyGraphicsQuality(getGraphicsQuality());

    resizeCanvas(this.canvas);
    initDecals(ARENA_W, ARENA_H);
    // poderes: visual "Novo" ou "Rascunho" conforme o guarda-roupa de quem conjurou
    setFxStyleProvider((id) => this.lookFor(id).fx ?? 0, () => this.selfId);
    setCorpseColorProvider((id) => {
      const l = this.lookFor(id);
      const o = OUTFITS[l.outfit] ?? OUTFITS[0]!;
      const h = HELMETS[l.helmet] ?? HELMETS[0]!;
      const full = h.style === "knight" || h.style === "darkLord" || h.style === "army" || h.style === "hood";
      return {
        shirt: o.top,
        pants: o.pants,
        skin: (SKIN_TONES[l.skin] ?? SKIN_TONES[1]!).color,
        hair: (HAIR_COLORS[l.hairColor] ?? HAIR_COLORS[0]!).color,
        shoes: (BOOTS[l.boots] ?? BOOTS[0]!).main,
        helmet: full ? h.main : undefined,
      };
    });
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
    this.transport.send(encodeHello(this.name, encodeLook(this.myLook)));
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
    castHoldStart: () => this.input.beginTotemAim(),
    castHoldEnd: () => this.input.endTotemAim(),
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
      for (const pl of this.lobby?.players ?? []) {
        this.names.set(pl.id, pl.name);
        const look = decodeLook(pl.look);
        if (look && pl.id !== this.selfId) this.looks.set(pl.id, look);
      }
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
      this.abilityDrops = [];
      clearAbilityFx();
      clearPowersFx();
      clearFx2();
      clearFxOwners();
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
      this.prediction.spikeTotems = (snap.spikeTotems ?? []).map((t) => ({
        x: t.x,
        y: t.y,
        r: TOTEM_RADIUS,
        ownerId: t.ownerId,
        angle: t.angle,
      }));
      for (const t of snap.spikeTotems ?? []) setTotemOwner(t.id, t.ownerId, t.angle);
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
            this.prediction.flashUntil = until;
            if (this.prediction.predicted) {
              (this.prediction.predicted as { flashUntil?: number }).flashUntil = until;
            }
          }
        }
        if (e.kind === "shot") {
          const self = e.a === this.selfId;
          pulseShotFeel(this.feel, e.weaponId ?? e.b, self);
          playWeaponShot(e.weaponId ?? e.b, e.x, e.y, listener);
          if (self) this.camZoom = this.baseZoom * 1.015;
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
          const big = e.kind === "explode" && e.b === 1;
          if (big) {
            if (fxOld(e.a)) spawnBigBoomFx(e.x, e.y, this.feel);
            else spawnBigBoom2(e.x, e.y, this.feel);
            playSfx("big_explosion", e.x, e.y, listener, { volumeMul: 1.55, rate: 0.72 });
            this.feel.shake = Math.max(this.feel.shake, 9.5);
            // flash cegante curto (mais suave que flashbang)
            this.flashBlind = Math.max(this.flashBlind, 0.72);
          } else {
            playSfx("explosion", e.x, e.y, listener);
            if (e.kind === "explode") this.feel.shake = Math.max(this.feel.shake, 5);
          }
        }
        if (e.kind === "hit" && e.b === 255) {
          stampBulletMark(e.x, e.y);
        } else if (e.kind === "hit" && e.b === 253) {
          // Escudo Estelar bloqueou / ricocheteou — faísca metálica, sem sangue
          spawnShieldSparks(e.x, e.y - ((e.weaponId ?? 0) === 9 ? 26 * BODY_K : 0), 12);
          if ((e.weaponId ?? 0) === 9) playSfx("clang", e.x, e.y, listener);
          else {
            // quem segurou o Escudo Estelar decide o visual do bloqueio
            let holder = -1;
            let best = 90;
            for (const p of snap.players) {
              if ((p.shieldUntil ?? 0) <= snap.serverTime) continue;
              const d = Math.hypot(p.x - e.x, p.y - e.y);
              if (d < best) {
                best = d;
                holder = p.id;
              }
            }
            if (holder >= 0 && !fxOld(holder)) spawnShieldRipple2(e.x, e.y + GUN_HAND_BODY_Y);
          }
          this.fx.push({
            x: e.x,
            y: e.y,
            r: 10,
            t: 180,
            kind: "explode",
          });
          for (let i = 0; i < 6; i++) {
            const ang = (i / 6) * Math.PI * 2 + Math.random() * 0.4;
            this.flashes.push({
              // -1: faísca do bloqueio, não é tiro do jogador local (sem muzzle flash)
              owner: -1,
              x: e.x,
              y: e.y,
              angle: ang,
              t: 70 + Math.random() * 40,
              sparks: [
                {
                  dx: Math.cos(ang) * (10 + Math.random() * 14),
                  dy: Math.sin(ang) * (10 + Math.random() * 14),
                  life: 80,
                },
              ],
            });
          }
          playSfx("block", e.x, e.y, listener);
        } else if (e.kind === "hit") {
          // 254 = hit em inimigo; player id = hit em jogador
          if (e.b !== 254) playSfx("hit_flesh", e.x, e.y, listener);
          if (e.b === this.selfId) {
            this.damageFlash = 1;
            this.feel.hurt = Math.max(this.feel.hurt, 1);
            const me =
              this.prediction.predicted ?? snap.players.find((p) => p.id === this.selfId);
            let ax = e.x;
            let ay = e.y;
            const atk = snap.players.find((p) => p.id === e.a);
            if (atk) {
              ax = atk.x;
              ay = atk.y;
            } else {
              const en = snap.enemies?.find((n) => n.id === e.a);
              if (en) {
                ax = en.x;
                ay = en.y;
              }
            }
            if (me) {
              this.dmgArrows.push({
                angle: Math.atan2(ay - me.y, ax - me.x),
                at: performance.now(),
              });
            }
          }
          // hitmarker visual só — NÃO tocar empty_click (é o SFX de erro/arma vazia)
          if (e.a === this.selfId && e.b !== this.selfId) {
            this.hitMarkerUntil = performance.now() + HITMARKER_MS;
          }
        }
        if (e.kind === "enemyDeath") {
          if ((e.weaponId ?? 0) === 102) {
            beginRiftSink(e.a, e.x, e.y, this.feel, "enemy", e.b & 0xff);
            playSfx("earth_slam", e.x, e.y, listener);
          } else {
            // gore por tipo (b = type)
            processGoreEvents(
              [{ kind: "death", a: 255, b: e.a, x: e.x, y: e.y, weaponId: e.b === 1 ? 100 : 0 }],
              performance.now(),
              this.selfId,
            );
            playSfx("hit_flesh", e.x, e.y, listener);
          }
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
        if (e.kind === "abilityDropSpawn") {
          this.abilityDrops = this.abilityDrops.filter((d) => d.id !== e.a);
          this.abilityDrops.push({
            id: e.a,
            x: e.x,
            y: e.y,
            abilityId: e.b,
          });
        }
        if (e.kind === "abilityDropTaken") {
          this.abilityDrops = this.abilityDrops.filter((d) => d.id !== e.a);
          playSfx("pickup", e.x, e.y, listener);
          if (e.b === this.selfId) {
            const aid = (e.weaponId ?? 2) & 0xff;
            if (this.prediction.predicted) {
              this.prediction.predicted.ability = aid;
              if (aid === 3) {
                this.prediction.predicted.dashCharges = DASH_MAX_CHARGES;
                this.prediction.predicted.dashRechargeAt = 0;
                this.prediction.predicted.dashUntil = 0;
              }
            }
            this.input.setAbility(aid);
          }
        }
        if (e.kind === "ability" && (e.b === 9 || e.b === 10 || e.b === 11)) {
          const wid = e.weaponId ?? 0;
          if (e.b === 10 && wid >= CHAIN_SEGMENT_BASE) {
            const hop = wid - CHAIN_SEGMENT_BASE;
            if (fxOld(e.a)) spawnLightningBolt(e.x, e.y, e.x2 ?? e.x, e.y2 ?? e.y, hop);
            else spawnBolt2(e.x, e.y, e.x2 ?? e.x, e.y2 ?? e.y, hop);
            if (hop === 0) {
              playSfx("zap", e.x, e.y, listener);
              if (e.a !== this.selfId) this.darkCastFx(e.a, e.x, e.y);
            }
            else playSfx("zap", e.x2 ?? e.x, e.y2 ?? e.y, listener, { volumeMul: 0.55 });
          } else if (e.b === 11) {
            if (e.a !== this.selfId) {
              if (fxOld(e.a)) spawnBlinkFx(e.x, e.y, e.x2 ?? e.x, e.y2 ?? e.y);
              else spawnBlink2(e.x, e.y, e.x2 ?? e.x, e.y2 ?? e.y, this.lookFor(e.a));
              this.darkCastFx(e.a, e.x, e.y);
              playSfx("blink", e.x2 ?? e.x, e.y2 ?? e.y, listener);
            }
          } else if (e.b === 9) {
            if (wid === 9001) {
              playSfx("clang", e.x, e.y, listener, { volumeMul: 0.7 });
              if (fxOld(e.a)) spawnShieldSparks(e.x, e.y - 26 * BODY_K, 5);
              else spawnDiscBounce2(e.x, e.y);
            } else if (wid === 9002) {
              if (fxOld(e.a)) spawnBlinkFx(e.x, e.y + 26, e.x, e.y + 26);
              else spawnDiscCatch2(e.x, e.y);
            } else if (e.a !== this.selfId) {
              playSfx("boost", e.x, e.y, listener);
              this.darkCastFx(e.a, e.x, e.y);
              if (!fxOld(e.a)) {
                const ang = e.angle ?? 0;
                spawnCastGlint2(
                  e.x + Math.cos(ang) * 24 * BODY_K,
                  e.y + (-30 + Math.sin(ang) * 16) * BODY_K,
                  CAST_RGB_DISC,
                );
              }
            }
          }
        } else if (e.kind === "ability") {
          const hitId = e.weaponId ?? 0;
          // impacto em alvo específico (knockback real / freeze)
          if (hitId >= 1000) {
            if (e.b === 8) {
              setFrostCaster(hitId - 1000, e.a);
              if (fxOld(e.a)) spawnFrostFreezeFx(e.x, e.y);
              else spawnFreeze2(e.x, e.y);
              playSfx("freeze", e.x, e.y, listener);
              const victimId = hitId - 1000;
              if (victimId === this.selfId && this.prediction.predicted) {
                const me = snap.players.find((p) => p.id === this.selfId);
                if (me) {
                  this.prediction.predicted.vx = 0;
                  this.prediction.predicted.vy = 0;
                  this.prediction.predicted.x = me.x;
                  this.prediction.predicted.y = me.y;
                  this.prediction.predicted.frozenUntil = me.frozenUntil;
                }
              }
            } else {
              if (fxOld(e.a)) spawnWaterSplash(e.x, e.y);
              else spawnWaterSplash2(e.x, e.y);
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
            }
          } else if (e.a !== this.selfId) {
            // conjuro remoto
            const newFx = !fxOld(e.a);
            processAbilityEvents(
              [e],
              this.feel,
              this.selfId,
              (x, y) => {
                if (e.b === 0) playSfx("water_whoosh", x, y, listener);
                else if (e.b === 2 || e.b === 3) playSfx("boost", x, y, listener);
                else if (e.b === 4) playSfx("block", x, y, listener);
                else if (e.b === 5) playSfx("earth_crack", x, y, listener);
                else if (e.b === 7) playSfx("boost", x, y, listener);
                else if (e.b === 8) playSfx("freeze", x, y, listener);
                else playSfx("explosion", x, y, listener);
              },
              undefined,
              newFx,
            );
            if (newFx) spawnRemoteCast2(e);
            if (e.b !== 3) this.darkCastFx(e.a, e.x, e.y);
          }
        }
        if (e.kind === "totemSpawn") {
          setTotemOwner(e.a, e.b, e.angle ?? 0);
          if (fxOld(e.b)) spawnTotemSpawnFx(e.x, e.y, e.a, e.angle ?? 0);
          else spawnTotem2(e.x, e.y, e.a, e.angle ?? 0, e.b === this.selfId);
          playSfx("boost", e.x, e.y, listener);
          this.feel.shake = Math.max(this.feel.shake, 0.55);
        }
        if (e.kind === "totemHit") {
          if (fxOld(totemOwnerOf(e.a))) spawnTotemHitFx(e.x, e.y);
          else spawnTotemHit2(e.x, e.y);
          playSfx("block", e.x, e.y, listener);
        }
        if (e.kind === "totemExpire") {
          const prev = this.lastSnap?.spikeTotems?.find((t) => t.id === (e.a & 0xff));
          const openAng = prev?.angle ?? totemAngleOf(e.a) ?? 0;
          if (fxOld(prev?.ownerId ?? totemOwnerOf(e.a))) spawnTotemExpireFx(e.x, e.y, e.a, openAng);
          else spawnTotemExpire2(e.x, e.y, e.a, openAng);
          playSfx("boost", e.x, e.y, listener);
        }
        if (e.kind === "rift") {
          processRiftEvents(
            [e],
            this.feel,
            (x, y) => {
              playSfx("earth_crack", x, y, listener);
            },
            undefined,
            !fxOld(e.a),
          );
          // slam quando o buraco abre — agendado pelo travelMs
          const travel = Math.max(120, e.weaponId ?? 400);
          const hx = e.x2 ?? e.x;
          const hy = e.y2 ?? e.y;
          window.setTimeout(() => {
            playSfx("earth_slam", hx, hy, listener);
            this.feel.shake = Math.max(this.feel.shake, 2.2);
          }, travel);
        }
        if (e.kind === "giantSpawn") {
          setGiantOwner(e.a, e.b);
          const packed = e.weaponId ?? 0;
          this.giantTargets.set(e.a, {
            kind: ((packed >> 8) & 3) as 0 | 1 | 2,
            id: packed & 0xff,
          });
          // Conjurador já tem FX predito; peers/bots veem o evento do host
          if (e.b !== this.selfId) {
            if (fxOld(e.b)) spawnGiantSummonFx(e.x, e.y);
            else spawnGiantSummon2(e.x, e.y);
            const dist = Math.hypot(e.x - listener.x, e.y - listener.y);
            if (dist < 520) {
              this.feel.shake = Math.max(this.feel.shake, 1.1 * (1 - dist / 520));
            }
          }
          playSfx("giant_roar", e.x, e.y, listener);
        }
        if (e.kind === "giantHit") {
          this.giantTargets.delete(e.a);
          this.giantBobPrev.delete(e.a);
          this.giantStatePrev.delete(e.a);
          this.giantPosPrev.delete(e.a);
          this.giantWindupAt.delete(e.a);
          this.giantVis.delete(e.a);
          if (fxOld(e.b)) spawnGiantHitFx(e.x, e.y);
          else spawnGiantHit2(e.x, e.y);
          playSfx("giant_hit", e.x, e.y, listener);
          const dist = Math.hypot(e.x - listener.x, e.y - listener.y);
          if (dist < 720) {
            const fall = Math.max(0.4, 1 - dist / 720);
            this.feel.shake = Math.max(this.feel.shake, 6 * fall);
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
          this.giantBobPrev.delete(e.a);
          this.giantStatePrev.delete(e.a);
          this.giantPosPrev.delete(e.a);
          this.giantWindupAt.delete(e.a);
          this.giantVis.delete(e.a);
          const cause = e.weaponId ?? 0;
          if (cause === 102) {
            // só Fenda Sísmica — animação de afundar
            beginRiftSink(e.a, e.x, e.y, this.feel, "enemy", 2);
            playSfx("earth_slam", e.x, e.y, listener);
            this.feel.shake = Math.max(this.feel.shake, 2.5);
          } else if (cause === 104) {
            // espinhos: dissolve / faísca — SEM cair no buraco
            if (fxOld(e.b)) {
              spawnTotemHitFx(e.x, e.y);
              spawnGiantExpireFx(e.x, e.y);
            } else {
              spawnTotemHit2(e.x, e.y);
              spawnGiantExpire2(e.x, e.y);
            }
            playSfx("block", e.x, e.y, listener);
            this.feel.shake = Math.max(this.feel.shake, 1.4);
          } else {
            if (fxOld(e.b)) spawnGiantExpireFx(e.x, e.y);
            else spawnGiantExpire2(e.x, e.y);
            playSfx("empty_click", e.x, e.y, listener);
          }
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
        if (e.kind === "death") {
          const cause = e.weaponId ?? 0;
          const giantKill = snap.events.some(
            (ev) =>
              ev.kind === "giantHit" &&
              ((ev.weaponId ?? 0) & 0xff) === e.b,
          );
          this.killFeed = pushKillFeed(this.killFeed, {
            killerId: e.a,
            victimId: e.b,
            cause,
            selfId: this.selfId,
            at: performance.now(),
            forceGiant:
              giantKill &&
              cause !== 100 &&
              cause !== 101 &&
              cause !== 102 &&
              cause !== 103 &&
              cause !== 200,
          });
          if (cause === 100 || cause === 103) playSfx("explosion", e.x, e.y, listener);
          if (cause === 102) {
            beginRiftSink(e.b, e.x, e.y, this.feel);
            playSfx("earth_slam", e.x, e.y, listener);
          }
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
          this.prediction.predicted.frozenUntil = me.frozenUntil ?? 0;
          this.prediction.predicted.speedBoostUntil = me.speedBoostUntil ?? 0;
          this.prediction.predicted.shieldUntil = me.shieldUntil ?? 0;
          this.prediction.predicted.dashCharges = me.dashCharges ?? DASH_MAX_CHARGES;
          this.prediction.predicted.dashRechargeAt = me.dashRechargeAt ?? 0;
          this.prediction.predicted.dashUntil = me.dashUntil ?? 0;
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

      // tempo de servidor estimado (stun/flash/boost não ficam presos entre snaps)
      const nowSrv =
        (this.lastSnap?.serverTime ?? 0) +
        Math.max(0, performance.now() - (this.lastSnapAt || performance.now()));

      this.prediction.applyHeld(
        raw.dx,
        raw.dy,
        raw.aim,
        dtSec,
        raw.sprint,
        raw.weapon,
        nowSrv,
      );

      const stunned = !!pred && (pred.stunnedUntil ?? 0) > nowSrv;
      const frozen = !!pred && (pred.frozenUntil ?? 0) > nowSrv;
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
      if (raw.fire && !stunned && !frozen && !flashed && this.localFireCd <= 0 && pred?.alive) {
        const wpn = WEAPONS[raw.weapon] ?? WEAPONS[0]!;
        if (magNow <= 0 || reloadingLocal) {
          this.localFireCd = 180;
          // empty_click = SFX de "erro"; não spammar a cada frame de hold
          if (magNow <= 0 && now - this.lastEmptyClickAt > 320) {
            this.lastEmptyClickAt = now;
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
          this.camZoom = this.baseZoom * 1.015;
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
      if (this.pendingCast && pred?.alive && !stunned && !frozen && !flashed) {
        pred.ability = raw.ability ?? pred.ability ?? 0;
        const ab = abilityOf(pred.ability ?? 0);
        const cdUntil = pred.abilityCdUntil ?? 0;
        const cdReady = ab.id === 3 || cdUntil <= nowSrv;
        if (cdReady && raw.cast) {
          if (ab.id === 11) {
            // Passo Sombrio: teleporte previsto (replay da reconciliação repete igual)
            const r = performBlink(
              pred,
              nowSrv,
              raw.aim,
              this.prediction.doorBits,
              hitsSolid,
              this.prediction.spikeTotems,
            );
            if (r) {
              if (fxOld(this.selfId)) spawnBlinkFx(r.fromX, r.fromY, r.x, r.y);
              else spawnBlink2(r.fromX, r.fromY, r.x, r.y, this.myLook);
              this.darkCastFx(this.selfId, r.fromX, r.fromY);
              playSfx("blink", r.x, r.y, { x: r.x, y: r.y });
              this.feel.shake = Math.max(this.feel.shake, 0.6);
              if (this.smooth) {
                this.smooth.errX = 0;
                this.smooth.errY = 0;
                this.smooth.t = 0;
              }
            }
          } else if (ab.id === 3) {
            // Manual: arremessa NA direção da mira
            if (
              performRecoilDash(
                pred,
                nowSrv,
                Math.cos(raw.aim),
                Math.sin(raw.aim),
              )
            ) {
              playSfx("boost", pred.x, pred.y, { x: pred.x, y: pred.y });
              this.feel.bodyKick = Math.max(this.feel.bodyKick, 0.55);
              this.feel.shake = Math.max(this.feel.shake, 0.8);
            }
          } else {
            pred.abilityCdUntil = nowSrv + ab.cooldownMs;
            const oldFx = fxOld(this.selfId);
            this.darkCastFx(this.selfId, pred.x, pred.y);
            if (ab.id === 0) {
              if (oldFx) spawnWaterJetFx(pred.x, pred.y, raw.aim);
              else spawnWaterJet2(pred.x, pred.y, raw.aim);
              this.feel.bodyKick = Math.max(this.feel.bodyKick, 0.7);
              this.feel.shake = Math.max(this.feel.shake, 1.2);
              playSfx("water_whoosh", pred.x, pred.y, { x: pred.x, y: pred.y });
            } else if (ab.id === 1) {
              const gx = pred.x + Math.cos(raw.aim) * 28;
              const gy = pred.y + Math.sin(raw.aim) * 28;
              if (oldFx) spawnGiantSummonFx(gx, gy);
              else spawnGiantSummon2(gx, gy);
              this.feel.shake = Math.max(this.feel.shake, 1.3);
              // rugido longo no evento giantSpawn (evita dobrar com predição)
            } else if (ab.id === 2) {
              pred.speedBoostUntil = nowSrv + SPRINT_BOOTS_DURATION_MS;
              if (!oldFx) spawnBootsCast2(pred.x, pred.y);
              playSfx("boost", pred.x, pred.y, { x: pred.x, y: pred.y });
              this.feel.bodyKick = Math.max(this.feel.bodyKick, 0.35);
            } else if (ab.id === 4) {
              pred.shieldUntil = nowSrv + SHIELD_MS;
              if (!oldFx) spawnShieldCast2(pred.x, pred.y, raw.aim);
              playSfx("block", pred.x, pred.y, { x: pred.x, y: pred.y });
              this.feel.bodyKick = Math.max(this.feel.bodyKick, 0.25);
            } else if (ab.id === 5) {
              // pisão predito — rachadura/kill vêm do host (evento rift)
              if (oldFx) spawnRiftStompFx(pred.x, pred.y);
              else spawnRiftStomp2(pred.x, pred.y);
              playSfx("earth_crack", pred.x, pred.y, { x: pred.x, y: pred.y });
              this.feel.bodyKick = Math.max(this.feel.bodyKick, 0.65);
              this.feel.shake = Math.max(this.feel.shake, 1.15);
            } else if (ab.id === 6) {
              // bomba predita — detonação/dano vêm do host (explode.b=1)
              const bx = pred.x + Math.cos(raw.aim) * 20;
              const by = pred.y + Math.sin(raw.aim) * 20;
              if (oldFx) spawnBombDropFx(bx, by);
              else spawnBombDrop2(bx, by);
              playSfx("boost", bx, by, { x: pred.x, y: pred.y });
              this.feel.bodyKick = Math.max(this.feel.bodyKick, 0.35);
              this.feel.shake = Math.max(this.feel.shake, 0.45);
            } else if (ab.id === 7) {
              // totem predito — entidade/dano vêm do host
              const plant = previewTotemPlant(
                pred.x,
                pred.y,
                raw.aim,
                this.input.totemAimDist,
                this.lastSnap?.doorsBits ?? 0,
              );
              const openAng = Math.atan2(pred.y - plant.y, pred.x - plant.x);
              if (oldFx) spawnTotemSpawnFx(plant.x, plant.y, undefined, openAng);
              else spawnTotem2(plant.x, plant.y, undefined, openAng);
              playSfx("boost", plant.x, plant.y, { x: pred.x, y: pred.y });
              this.feel.bodyKick = Math.max(this.feel.bodyKick, 0.3);
              this.feel.shake = Math.max(this.feel.shake, 0.4);
            } else if (ab.id === 9) {
              // arremesso: o disco vem do host (throwable kind 7)
              const hx = pred.x + Math.cos(raw.aim) * 24 * BODY_K;
              const hy = pred.y + (-30 + Math.sin(raw.aim) * 16) * BODY_K;
              if (oldFx) spawnCastSparkle(hx, hy);
              else spawnCastGlint2(hx, hy, CAST_RGB_DISC);
              playSfx("boost", pred.x, pred.y, { x: pred.x, y: pred.y });
              this.feel.bodyKick = Math.max(this.feel.bodyKick, 0.45);
            } else if (ab.id === 10) {
              // raio: os saltos vêm do host (eventos com x2/y2)
              const hx = pred.x + Math.cos(raw.aim) * 26 * BODY_K;
              const hy = pred.y + (-26 + Math.sin(raw.aim) * 18) * BODY_K;
              if (oldFx) spawnCastSparkle(hx, hy);
              else spawnCastGlint2(hx, hy, CAST_RGB_VOLT);
              this.feel.bodyKick = Math.max(this.feel.bodyKick, 0.4);
              this.feel.shake = Math.max(this.feel.shake, 0.5);
            } else if (ab.id === 8) {
              if (oldFx) spawnFrostCastFx(pred.x, pred.y, raw.aim);
              else spawnFrost2(pred.x, pred.y, raw.aim);
              playSfx("freeze", pred.x, pred.y, { x: pred.x, y: pred.y });
              this.feel.bodyKick = Math.max(this.feel.bodyKick, 0.45);
              this.feel.shake = Math.max(this.feel.shake, 0.55);
            }
          }
        }
      }

      // Capa de Recuo inteligente — predição local do auto-dodge
      if (pred?.alive && !stunned && !frozen && !flashed && (pred.ability ?? 0) === 3) {
        const bullets = [
          ...(this.lastSnap?.bullets ?? []),
          ...this.prediction.localBullets,
        ];
        const enemies = (this.lastSnap?.enemies ?? []).map((e) => ({
          x: e.x,
          y: e.y,
          type: e.type,
          state: e.state,
        }));
        if (tryAutoRecoilCape(pred, nowSrv, bullets, enemies)) {
          const slid = moveAndSlide(
            pred.x,
            pred.y,
            pred.vx,
            pred.vy,
            DASH_BURST_DT,
            PLAYER_R,
            this.prediction.doorBits,
          );
          const solid = resolveTotemBody(slid.x, slid.y, PLAYER_R, this.prediction.spikeTotems);
          pred.x = solid.x;
          pred.y = solid.y;
          playSfx("boost", pred.x, pred.y, { x: pred.x, y: pred.y });
          this.feel.bodyKick = Math.max(this.feel.bodyKick, 0.5);
          this.feel.shake = Math.max(this.feel.shake, 0.7);
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
          // totem: throw já vem quantizado do sample no frame do cast
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
    tickAbilityFx(dtMs, this.feel);
    tickShieldSparks(dtMs);
    tickPowersFx(dtMs);
    tickFx2(dtMs, this.feel);
    if (now - this.lastCapePrune > 2000) {
      this.lastCapePrune = now;
      pruneCapes(now);
    }
    // Fim do gelo → estilhaço (detecção client-side a partir de frozenUntil autoritativo)
    {
      const nowSrvFrost =
        (this.lastSnap?.serverTime ?? 0) +
        Math.max(0, performance.now() - (this.lastSnapAt || performance.now()));
      const frostEnts: { key: string; x: number; y: number; frozen: boolean; scale?: number }[] =
        [];
      for (const p of this.lastSnap?.players ?? []) {
        frostEnts.push({
          key: `p${p.id}`,
          x: p.x,
          y: p.y,
          frozen: p.alive && (p.frozenUntil ?? 0) > nowSrvFrost,
        });
      }
      // local predito (posição suave) se for o self congelado
      const pred = this.prediction.predicted;
      if (pred && this.selfId >= 0) {
        const i = frostEnts.findIndex((e) => e.key === `p${this.selfId}`);
        if (i >= 0) {
          frostEnts[i] = {
            key: `p${this.selfId}`,
            x: pred.x,
            y: pred.y,
            frozen: pred.alive && (pred.frozenUntil ?? 0) > nowSrvFrost,
          };
        }
      }
      for (const en of this.lastSnap?.enemies ?? []) {
        frostEnts.push({
          key: `e${en.id}`,
          x: en.x,
          y: en.y,
          frozen: (en.frozenUntil ?? 0) > nowSrvFrost,
          scale: en.type === 2 ? 2.2 : en.type === 1 ? 1.5 : 1,
        });
      }
      const listenerPos = {
        x: pred?.x ?? this.lastSnap?.players.find((p) => p.id === this.selfId)?.x ?? 0,
        y: pred?.y ?? this.lastSnap?.players.find((p) => p.id === this.selfId)?.y ?? 0,
      };
      syncFrostShatter(
        frostEnts,
        (x, y) => {
          playSfx("ice_shatter", x, y, listenerPos);
          this.feel.shake = Math.max(this.feel.shake, 0.35);
        },
        (key) => (frostIsOld(Number(key.slice(1))) ? null : spawnShatter2),
      );
    }
    this.camZoom += (this.baseZoom - this.camZoom) * Math.min(1, dtMs / 80);
    this.damageFlash = Math.max(0, this.damageFlash - dtMs / 120);
    this.killFeed = pruneKillFeed(this.killFeed, now);
    this.dmgArrows = pruneDmgArrows(this.dmgArrows, now);
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
      // flashbang (~1) decai lento; flash curto da bomba (<1) some rápido
      const decay = this.flashBlind > 0.95 ? 2400 : 320;
      this.flashBlind = Math.max(0, this.flashBlind - dtMs / decay);
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
        frozenUntil: pr.frozenUntil ?? 0,
        speedBoostUntil: pr.speedBoostUntil ?? 0,
        shieldUntil: pr.shieldUntil ?? 0,
        dashUntil: pr.dashUntil ?? 0,
        ability: pr.ability ?? 0,
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
          frozenUntil: me.frozenUntil ?? 0,
          speedBoostUntil: me.speedBoostUntil ?? 0,
          shieldUntil: me.shieldUntil ?? 0,
          dashUntil: me.dashUntil ?? 0,
          ability: me.ability ?? 0,
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
        this.giantBobPrev.delete(gid);
        this.giantStatePrev.delete(gid);
        this.giantPosPrev.delete(gid);
        this.giantWindupAt.delete(gid);
        this.giantVis.delete(gid);
      }
    }

    // juice do Gigante: passos, windup, massa, micro-tremor
    const listenerPos = local
      ? { x: local.x, y: local.y }
      : { x: focusX, y: focusY };
    for (const en of liveEnemies) {
      if (en.type !== 2) continue;
      const windup = en.state === 2 || en.state === 4;
      const chase = en.state === 1;
      const prevState = this.giantStatePrev.get(en.id) ?? en.state;
      this.giantStatePrev.set(en.id, en.state);

      // facing / skew (massa ao virar)
      const prevP = this.giantPosPrev.get(en.id);
      let facing = this.giantVis.get(en.id)?.facing ?? 0;
      let skew = (this.giantVis.get(en.id)?.skew ?? 0) * 0.85;
      if (prevP) {
        const dx = en.x - prevP.x;
        const dy = en.y - prevP.y;
        if (dx * dx + dy * dy > 0.35) {
          const nf = Math.atan2(dy, dx);
          let dAng = nf - facing;
          while (dAng > Math.PI) dAng -= Math.PI * 2;
          while (dAng < -Math.PI) dAng += Math.PI * 2;
          facing = nf;
          skew = Math.max(-0.08, Math.min(0.08, dAng * 2.8));
        }
      }
      this.giantPosPrev.set(en.id, { x: en.x, y: en.y });

      // início do windup → rugido curto + flash
      if (windup && prevState !== 2 && prevState !== 4) {
        this.giantWindupAt.set(en.id, now);
        playSfx("giant_roar_short", en.x, en.y, listenerPos);
      }
      let windupFlash = 0;
      if (windup) {
        const started = this.giantWindupAt.get(en.id) ?? now;
        windupFlash = Math.max(0, 1 - (now - started) / 150);
        if (local?.alive) {
          const d = Math.hypot(en.x - local.x, en.y - local.y);
          if (d < 560) {
            const prog = 1 - windupFlash;
            this.feel.shake = Math.max(
              this.feel.shake,
              (0.9 + prog * 2.6) * (1 - d / 560),
            );
          }
        }
      } else {
        this.giantWindupAt.delete(en.id);
      }
      this.giantVis.set(en.id, { facing, skew, windupFlash });

      // pisada: cruzamento da fase baixa do bob
      const phase = Math.sin(now * 0.01 + en.id);
      const prevPhase = this.giantBobPrev.get(en.id) ?? phase;
      this.giantBobPrev.set(en.id, phase);
      if (chase && prevPhase > 0 && phase <= 0) {
        if (local?.alive) {
          const d = Math.hypot(en.x - local.x, en.y - local.y);
          if (d < 560) {
            this.feel.shake = Math.max(this.feel.shake, 2.2 * (1 - d / 560));
          }
        }
        spawnGiantStepDust(en.x, en.y);
        playSfx("giant_step", en.x, en.y, listenerPos);
      }

      // micro-tremor contínuo perto
      if (local?.alive) {
        const d = Math.hypot(en.x - local.x, en.y - local.y);
        if (d < 120) {
          this.feel.shake = Math.max(this.feel.shake, 0.35 * (1 - d / 120));
        }
      }
    }

    // chamas das Botas / vento da Capa (visual novo) em quem está com o poder ativo
    {
      const srvT = (this.lastSnap?.serverTime ?? 0) + Math.max(0, now - (this.lastSnapAt || now));
      const actors: AuraActor[] = [];
      const add = (
        id: number,
        p: {
          x: number;
          y: number;
          vx?: number;
          vy?: number;
          angle?: number;
          alive: boolean;
          ability?: number;
          speedBoostUntil?: number;
          dashUntil?: number;
        },
      ) => {
        const ab = p.ability ?? 0;
        if (!p.alive || (ab !== 2 && ab !== 3) || fxOld(id)) return;
        const lk = this.lookFor(id);
        actors.push({
          id,
          x: p.x,
          y: p.y,
          vx: p.vx ?? 0,
          vy: p.vy ?? 0,
          boost: ab === 2 && (p.speedBoostUntil ?? 0) > srvT,
          dash: ab === 3 && (p.dashUntil ?? 0) > srvT,
          aim: p.angle,
          look: lk.body === 0 ? lk : null,
          dark: CAPES[lk.cape]?.style === "dark",
        });
      };
      if (local) add(this.selfId, local);
      for (const r of remotes) add(r.id, r);
      tickAuras2(actors, dtMs);
    }

    let totemAim: { fromX: number; fromY: number; toX: number; toY: number } | null = null;
    if (this.input.isTotemAiming() && local?.alive) {
      const plant = previewTotemPlant(
        local.x,
        local.y,
        local.angle,
        this.input.totemAimDist,
        bits,
      );
      totemAim = { fromX: local.x, fromY: local.y, toX: plant.x, toY: plant.y };
    }

    const view: RenderView = {
      selfId: this.selfId,
      local,
      remotes,
      enemies: liveEnemies,
      giantTargets: this.giantTargets,
      giantVis: this.giantVis,
      bullets,
      throwables: (this.lastSnap?.throwables ?? []).map((t) => {
        if (t.kind !== SHIELD_THROW_KIND) return t;
        // disco rápido: extrapola entre snapshots (30 Hz) pra não "pular"
        const k = Math.min(0.06, Math.max(0, (now - (this.lastSnapAt || now)) / 1000));
        return { ...t, x: t.x + t.vx * k, y: t.y + t.vy * k };
      }),
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
      abilityDrops: this.abilityDrops,
      spikeTotems: this.lastSnap?.spikeTotems ?? [],
      totemAim,
      drawSpikeTotems: drawTotemsByStyle,
      drawTotemAimBeam: fxOld(this.selfId) ? drawTotemAimBeam : drawTotemAim2,
      drawTotemHoloDissolves,
      camZoom: this.camZoom,
      camX: this.camX,
      camY: this.camY,
      damageFlash: this.damageFlash,
      hitFlashSelf: hitFlashActive(this.selfId, now),
      dmgArrows: this.dmgArrows,
      hitMarker: Math.max(0, (this.hitMarkerUntil - now) / HITMARKER_MS),
      nowMs: now,
      drawDecals: drawDecalLayer,
      drawGore: drawGoreActors,
      drawAbilityGround,
      drawAbilityWater,
      serverTime:
        (this.lastSnap?.serverTime ?? 0) +
        Math.max(0, now - (this.lastSnapAt || now)),
      lookFor: this.lookFor,
      nameFor: this.nameFor,
    };

    try {
      if (this.phase === "playing" || this.phase === "result") {
        drawFrame(this.ctx, view, now);
      } else {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // sala de espera: pinta o mapa em volta do provável spawn aos poucos
        if (this.phase === "lobby" && this.selfId >= 0 && !this.worldWarm) {
          const sp = SPAWNS[this.selfId % SPAWNS.length]!;
          this.worldWarm = prewarmWorld(sp.x, sp.y, 1300, 2) === 0;
        }
      }
    } catch (err) {
      console.error("drawFrame", err);
    }

    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
}
