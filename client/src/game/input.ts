/** WASD/setas, sprint, armas 1-7, throwables G/F/C/V, E porta, Q habilidade, mira/tiro. */
import { ABILITY_CYCLE_IDS } from "../../../shared/abilities";

export interface RawInput {
  dx: number;
  dy: number;
  aim: number;
  fire: boolean;
  sprint: boolean;
  use: boolean;
  reload: boolean;
  cast: boolean;
  weapon: number;
  throw: number;
  /** id da habilidade (0 jato, 1 gigante, 2 botas, 3 capa recuo, 4 capa escudo) */
  ability: number;
}

const MOVE_CODES: Record<string, { dx: number; dy: number; axis: "x" | "y" }> = {
  KeyW: { dx: 0, dy: -1, axis: "y" },
  KeyA: { dx: -1, dy: 0, axis: "x" },
  KeyS: { dx: 0, dy: 1, axis: "y" },
  KeyD: { dx: 1, dy: 0, axis: "x" },
  ArrowUp: { dx: 0, dy: -1, axis: "y" },
  ArrowLeft: { dx: -1, dy: 0, axis: "x" },
  ArrowDown: { dx: 0, dy: 1, axis: "y" },
  ArrowRight: { dx: 1, dy: 0, axis: "x" },
};

const EXTRA_CODES = new Set([
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "KeyE",
  "KeyR",
  "KeyQ",
  "KeyT",
  "KeyG",
  "KeyF",
  "KeyC",
  "KeyV",
]);

/**
 * keyup falso ao apertar Shift com WASD: browser às vezes manda keyup+keydown.
 * Só atrasamos o release se o Shift acabou de mudar — atrasar SEMPRE fazia
 * keydown.repeat cancelar o keyup real e a tecla (ex.: S) ficava presa →
 * personagem correndo pra baixo sem parar.
 */
const SPURIOUS_KEYUP_MS = 60;
const SHIFT_EDGE_WINDOW_MS = 90;

export class InputController {
  private down = new Set<string>();
  /** última tecla por eixo — opostas não se anulam (a mais recente vence) */
  private lastX: string | null = null;
  private lastY: string | null = null;
  /** keyups de movimento pendentes (código → timer) */
  private pendingUp = new Map<string, number>();
  /** backup via e.shiftKey — sobrevive a keyup perdido do Shift */
  private shiftHeld = false;
  /** performance.now() da última borda do Shift (down/up) */
  private shiftEdgeAt = 0;
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  /** pointerId do botão esquerdo em hold — evita pointerup de outro dedo/UI zerar o tiro */
  private firePointerId: number | null = null;
  weapon = 0;
  ability = 0;
  private throwPulse = 0;
  private usePulse = false;
  private reloadPulse = false;
  private castPulse = false;
  touchMove = { x: 0, y: 0, active: false };
  touchAim = { x: 0, y: 0, active: false, firing: false };
  /** HUD touch ativo — canvas não compete com os sticks */
  private touchUi = false;
  private touchSprint = false;
  private canvas: HTMLCanvasElement | null = null;
  private attached = false;

  setTouchUi(on: boolean) {
    this.touchUi = on;
    if (!on) {
      this.touchMove = { x: 0, y: 0, active: false };
      this.touchAim = { x: 0, y: 0, active: false, firing: false };
      this.touchSprint = false;
    }
  }

  setVirtualMove(x: number, y: number, active: boolean) {
    this.touchMove = {
      active,
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
    };
  }

  setVirtualAim(x: number, y: number, active: boolean, firing: boolean) {
    this.touchAim = {
      active,
      firing: active && firing,
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
    };
  }

  setVirtualSprint(on: boolean) {
    this.touchSprint = on;
  }

  pulseCast() {
    this.castPulse = true;
  }

  pulseReload() {
    this.reloadPulse = true;
  }

  pulseUse() {
    this.usePulse = true;
  }

  toggleAbility() {
    // Jato → Gigante → Botas → Capa-Escudo → …
    const cycle = ABILITY_CYCLE_IDS as unknown as number[];
    const i = cycle.indexOf(this.ability);
    this.ability = cycle[((i < 0 ? 0 : i) + 1) % cycle.length]!;
  }

  setAbility(id: number) {
    const cycle = ABILITY_CYCLE_IDS as unknown as number[];
    this.ability = cycle.includes(id) ? id : 0;
  }

  setWeaponSlot(id: number) {
    this.weapon = Math.max(0, Math.min(6, id | 0));
  }

  cycleWeapon(dir: 1 | -1) {
    this.weapon = (this.weapon + dir + 7) % 7;
  }

  private codeFromEvent(e: KeyboardEvent): string | null {
    if (e.code && (e.code in MOVE_CODES || EXTRA_CODES.has(e.code))) return e.code;
    const k = e.key.toLowerCase();
    if (k === "shift") return e.location === 2 ? "ShiftRight" : "ShiftLeft";
    const byKey: Record<string, string> = {
      w: "KeyW",
      a: "KeyA",
      s: "KeyS",
      d: "KeyD",
      arrowup: "ArrowUp",
      arrowdown: "ArrowDown",
      arrowleft: "ArrowLeft",
      arrowright: "ArrowRight",
      " ": "Space",
      1: "Digit1",
      2: "Digit2",
      3: "Digit3",
      4: "Digit4",
      5: "Digit5",
      6: "Digit6",
      7: "Digit7",
      e: "KeyE",
      r: "KeyR",
      q: "KeyQ",
      t: "KeyT",
      g: "KeyG",
      f: "KeyF",
      c: "KeyC",
      v: "KeyV",
    };
    return byKey[k] ?? null;
  }

  private cancelPendingUp(code: string) {
    const t = this.pendingUp.get(code);
    if (t !== undefined) {
      clearTimeout(t);
      this.pendingUp.delete(code);
    }
  }

  private releaseMoveKey(code: string) {
    this.down.delete(code);
    const move = MOVE_CODES[code];
    if (!move) return;
    if (this.lastX === code) this.lastX = this.pickAxisKey("x");
    if (this.lastY === code) this.lastY = this.pickAxisKey("y");
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.shiftHeld = e.shiftKey;
    const code = this.codeFromEvent(e);
    if (!code) return;

    // repeat NÃO deve cancelar keyup pendente nem rearmar tecla — causa S/↓ preso
    if (e.repeat) return;

    if (code === "ShiftLeft" || code === "ShiftRight") {
      this.shiftEdgeAt = performance.now();
    }

    // cancela keyup falso (ex.: apertar Shift com W segurado → keyup+keydown)
    this.cancelPendingUp(code);

    this.down.add(code);
    // não preventDefault no Shift — evita interferência do browser com WASD
    if (code !== "ShiftLeft" && code !== "ShiftRight") {
      e.preventDefault();
    }

    const move = MOVE_CODES[code];
    if (move) {
      if (move.axis === "x") this.lastX = code;
      else this.lastY = code;
    }

    if (code === "Digit1") this.weapon = 0;
    if (code === "Digit2") this.weapon = 1;
    if (code === "Digit3") this.weapon = 2;
    if (code === "Digit4") this.weapon = 3;
    if (code === "Digit5") this.weapon = 4;
    if (code === "Digit6") this.weapon = 5;
    if (code === "Digit7") this.weapon = 6;
    if (code === "KeyE") this.usePulse = true;
    if (code === "KeyR") this.reloadPulse = true;
    if (code === "KeyQ") this.castPulse = true;
    if (code === "KeyT") this.toggleAbility();
    if (code === "KeyG") this.throwPulse = 1;
    if (code === "KeyF") this.throwPulse = 2;
    if (code === "KeyC") this.throwPulse = 3;
    if (code === "KeyV") this.throwPulse = 4;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.shiftHeld = e.shiftKey;
    const code = this.codeFromEvent(e);
    if (!code) return;

    if (code === "ShiftLeft" || code === "ShiftRight") {
      this.shiftEdgeAt = performance.now();
      this.down.delete(code);
      if (!this.down.has("ShiftLeft") && !this.down.has("ShiftRight")) {
        this.shiftHeld = false;
      }
      return;
    }

    if (code in MOVE_CODES) {
      this.cancelPendingUp(code);
      const recentShift = performance.now() - this.shiftEdgeAt < SHIFT_EDGE_WINDOW_MS;
      if (recentShift) {
        // possível keyup espúrio do Shift — espera o keydown real voltar
        const t = window.setTimeout(() => {
          this.pendingUp.delete(code);
          this.releaseMoveKey(code);
        }, SPURIOUS_KEYUP_MS);
        this.pendingUp.set(code, t);
      } else {
        // keyup real: solta na hora (evita S/↓ preso)
        this.releaseMoveKey(code);
      }
      return;
    }

    this.down.delete(code);
    e.preventDefault();
  };

  private pickAxisKey(axis: "x" | "y"): string | null {
    let found: string | null = null;
    for (const code of this.down) {
      const m = MOVE_CODES[code];
      if (m && m.axis === axis) found = code;
    }
    return found;
  }

  /** Só teclado/touch-move — NÃO mexe em mouseDown (blur falso ao focar canvas matava o tiro). */
  private clearKeyboard = () => {
    for (const t of this.pendingUp.values()) clearTimeout(t);
    this.pendingUp.clear();
    this.down.clear();
    this.lastX = null;
    this.lastY = null;
    this.shiftHeld = false;
    this.shiftEdgeAt = 0;
    this.touchMove = { x: 0, y: 0, active: false };
    this.touchAim = { x: 0, y: 0, active: false, firing: false };
  };

  private clearKeys = () => {
    this.clearKeyboard();
    this.mouseDown = false;
    this.firePointerId = null;
  };

  /** Re-sincroniza hold do LMB com o estado real do browser. */
  private syncMouseButtons(buttons: number) {
    if ((buttons & 1) === 1) {
      this.mouseDown = true;
    } else if (this.firePointerId == null) {
      this.mouseDown = false;
    }
  }

  private onVisibility = () => {
    // aba oculta de verdade — zera tudo (keyup/mouseup se perdem)
    if (document.hidden) this.clearKeys();
  };

  /** Alt-Tab / foco da janela — limpa WASD preso, mantém botão do mouse. */
  private onWindowBlur = () => {
    this.clearKeyboard();
  };

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    if (this.attached) return;
    this.attached = true;

    // capture: recebe antes de outros handlers / foco perdido
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("blur", this.onWindowBlur);

    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
      // só REARMA se LMB estiver baixo — nunca zera no move (buttons===0 falso com capture)
      if ((e.buttons & 1) === 1) this.mouseDown = true;
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.touchUi && e.pointerType !== "mouse") return;
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
      if ((e.buttons & 1) === 1) this.mouseDown = true;
    });
    const block = (e: Event) => e.preventDefault();
    canvas.addEventListener("contextmenu", block);
    canvas.addEventListener("auxclick", block);
    canvas.addEventListener("selectstart", block);
    canvas.addEventListener("dragstart", block);
    canvas.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (e.button === 0) this.mouseDown = true;
      // só foca se preciso — focus repetido em alguns WebViews dispara blur e matava o tiro
      if (document.activeElement !== canvas) {
        canvas.focus({ preventScroll: true });
      }
    });
    canvas.addEventListener("pointerdown", (e) => {
      // com HUD touch, o canvas não atira — sticks cuidam disso
      if (this.touchUi && e.pointerType !== "mouse") return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.button === 0 || e.pointerType === "touch") {
        this.mouseDown = true;
        this.firePointerId = e.pointerId;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
    });
    const endFire = (e: MouseEvent | PointerEvent) => {
      // só solta no botão esquerdo / touch; ignora outros botões
      if ("button" in e && e.button !== 0 && e.button !== -1) return;
      // LMB ainda pressionado (outro pointer soltou) — mantém tiro
      if ("buttons" in e && (e.buttons & 1) === 1) {
        this.mouseDown = true;
        return;
      }
      // pointerup de outro dedo/UI não cancela o hold do mouse
      if (
        "pointerId" in e &&
        this.firePointerId != null &&
        e.pointerId !== this.firePointerId
      ) {
        return;
      }
      this.mouseDown = false;
      this.firePointerId = null;
    };
    window.addEventListener("mouseup", endFire);
    window.addEventListener("pointerup", endFire);
    window.addEventListener("pointercancel", (e: PointerEvent) => {
      if (this.firePointerId != null && e.pointerId !== this.firePointerId) return;
      // cancel com LMB ainda baixo (comum em capture) — não zera
      if ((e.buttons & 1) === 1) {
        this.mouseDown = true;
        return;
      }
      this.mouseDown = false;
      this.firePointerId = null;
    });
    canvas.addEventListener("lostpointercapture", (e: PointerEvent) => {
      if (this.firePointerId != null && e.pointerId !== this.firePointerId) return;
      if ((e.buttons & 1) === 1) {
        this.mouseDown = true;
        return;
      }
      // perdeu capture e botão solto
      this.syncMouseButtons(e.buttons);
      if ((e.buttons & 1) === 0) this.firePointerId = null;
    });
    canvas.setAttribute("tabindex", "0");

    canvas.addEventListener(
      "touchstart",
      (e) => {
        if (this.touchUi) return;
        e.preventDefault();
        this.handleTouches(e);
      },
      { passive: false },
    );
    canvas.addEventListener(
      "touchmove",
      (e) => {
        if (this.touchUi) return;
        e.preventDefault();
        this.handleTouches(e);
      },
      { passive: false },
    );
    canvas.addEventListener("touchend", (e) => {
      if (this.touchUi) return;
      this.handleTouches(e);
    });
  }

  private handleTouches(e: TouchEvent) {
    // fallback antigo (metade da tela) — só sem HUD touch
    const r = this.canvas!.getBoundingClientRect();
    const mid = r.width / 2;
    this.touchMove.active = false;
    this.touchAim.active = false;
    this.touchAim.firing = false;
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i]!;
      const x = t.clientX - r.left;
      const y = t.clientY - r.top;
      if (x < mid) {
        this.touchMove = {
          active: true,
          x: (x - mid / 2) / (mid / 2),
          y: (y - r.height / 2) / (r.height / 2),
        };
      } else {
        this.touchAim = {
          active: true,
          firing: true,
          x: (x - mid - mid / 2) / (mid / 2),
          y: (y - r.height / 2) / (r.height / 2),
        };
      }
    }
  }

  get isMoving(): boolean {
    for (const c of this.down) if (c in MOVE_CODES) return true;
    return this.touchMove.active;
  }

  /**
   * Estado contínuo (mira/WASD/tiro) SEM consumir pulsos Q/R/E/throw.
   * Usar no reconcile do snapshot — sample() no snap comia o Q.
   */
  peek(
    worldFromScreen: (sx: number, sy: number) => { x: number; y: number },
    px: number,
    py: number,
  ): RawInput {
    return this.buildRaw(worldFromScreen, px, py, false);
  }

  sample(
    worldFromScreen: (sx: number, sy: number) => { x: number; y: number },
    px: number,
    py: number,
  ): RawInput {
    return this.buildRaw(worldFromScreen, px, py, true);
  }

  private buildRaw(
    worldFromScreen: (sx: number, sy: number) => { x: number; y: number },
    px: number,
    py: number,
    consumePulses: boolean,
  ): RawInput {
    let dx = 0;
    let dy = 0;
    // última tecla por eixo vence (W+S não trava; a mais recente manda)
    if (this.lastX && this.down.has(this.lastX)) {
      dx = MOVE_CODES[this.lastX]!.dx;
    } else {
      this.lastX = this.pickAxisKey("x");
      if (this.lastX) dx = MOVE_CODES[this.lastX]!.dx;
    }
    if (this.lastY && this.down.has(this.lastY)) {
      dy = MOVE_CODES[this.lastY]!.dy;
    } else {
      this.lastY = this.pickAxisKey("y");
      if (this.lastY) dy = MOVE_CODES[this.lastY]!.dy;
    }

    if (this.touchMove.active) {
      dx = Math.max(-1, Math.min(1, this.touchMove.x));
      dy = Math.max(-1, Math.min(1, this.touchMove.y));
    }

    let aim = 0;
    if (this.touchAim.active) {
      aim = Math.atan2(this.touchAim.y, this.touchAim.x);
    } else {
      const w = worldFromScreen(this.mouseX, this.mouseY);
      aim = Math.atan2(w.y - py, w.x - px);
    }

    let thr = this.throwPulse;
    let use = this.usePulse;
    let reload = this.reloadPulse;
    let cast = this.castPulse;
    if (consumePulses) {
      this.throwPulse = 0;
      this.usePulse = false;
      this.reloadPulse = false;
      this.castPulse = false;
    } else {
      thr = 0;
      use = false;
      reload = false;
      cast = false;
    }

    return {
      dx,
      dy,
      aim,
      fire: this.mouseDown || this.touchAim.firing || this.down.has("Space"),
      sprint:
        this.touchSprint ||
        this.shiftHeld ||
        this.down.has("ShiftLeft") ||
        this.down.has("ShiftRight"),
      use,
      reload,
      cast,
      weapon: this.weapon,
      throw: thr,
      ability: this.ability,
    };
  }
}
