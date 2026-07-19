/** WASD/setas, sprint, armas 1-7, throwables G/F/C/V, E porta, mira/tiro. */

export interface RawInput {
  dx: number;
  dy: number;
  aim: number;
  fire: boolean;
  sprint: boolean;
  use: boolean;
  weapon: number;
  throw: number;
}

const MOVE_CODES: Record<string, { dx: number; dy: number }> = {
  KeyW: { dx: 0, dy: -1 },
  KeyA: { dx: -1, dy: 0 },
  KeyS: { dx: 0, dy: 1 },
  KeyD: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowRight: { dx: 1, dy: 0 },
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
  "KeyG",
  "KeyF",
  "KeyC",
  "KeyV",
]);

export class InputController {
  private down = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  weapon = 0;
  private throwPulse = 0;
  private usePulse = false;
  touchMove = { x: 0, y: 0, active: false };
  touchAim = { x: 0, y: 0, active: false, firing: false };
  private canvas: HTMLCanvasElement | null = null;
  private attached = false;

  private codeFromEvent(e: KeyboardEvent): string | null {
    if (e.code && (e.code in MOVE_CODES || EXTRA_CODES.has(e.code))) return e.code;
    const k = e.key.toLowerCase();
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
      shift: "ShiftLeft",
      1: "Digit1",
      2: "Digit2",
      3: "Digit3",
      4: "Digit4",
      5: "Digit5",
      6: "Digit6",
      7: "Digit7",
      e: "KeyE",
      g: "KeyG",
      f: "KeyF",
      c: "KeyC",
      v: "KeyV",
    };
    return byKey[k] ?? null;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) {
      if (this.codeFromEvent(e)) e.preventDefault();
      return;
    }
    const code = this.codeFromEvent(e);
    if (!code) return;
    this.down.add(code);
    e.preventDefault();

    if (code === "Digit1") this.weapon = 0;
    if (code === "Digit2") this.weapon = 1;
    if (code === "Digit3") this.weapon = 2;
    if (code === "Digit4") this.weapon = 3;
    if (code === "Digit5") this.weapon = 4;
    if (code === "Digit6") this.weapon = 5;
    if (code === "Digit7") this.weapon = 6;
    if (code === "KeyE") this.usePulse = true;
    if (code === "KeyG") this.throwPulse = 1;
    if (code === "KeyF") this.throwPulse = 2;
    if (code === "KeyC") this.throwPulse = 3;
    if (code === "KeyV") this.throwPulse = 4;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const code = this.codeFromEvent(e);
    if (!code) return;
    this.down.delete(code);
    e.preventDefault();
  };

  private onBlur = () => {
    this.down.clear();
    this.mouseDown = false;
  };

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    if (this.attached) return;
    this.attached = true;

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);

    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    });
    const block = (e: Event) => e.preventDefault();
    canvas.addEventListener("contextmenu", block);
    canvas.addEventListener("auxclick", block);
    canvas.addEventListener("selectstart", block);
    canvas.addEventListener("dragstart", block);
    canvas.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (e.button === 0) this.mouseDown = true;
      canvas.focus({ preventScroll: true });
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    canvas.setAttribute("tabindex", "0");

    canvas.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        this.handleTouches(e);
      },
      { passive: false },
    );
    canvas.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
        this.handleTouches(e);
      },
      { passive: false },
    );
    canvas.addEventListener("touchend", (e) => this.handleTouches(e));
  }

  private handleTouches(e: TouchEvent) {
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

  sample(
    worldFromScreen: (sx: number, sy: number) => { x: number; y: number },
    px: number,
    py: number,
  ): RawInput {
    let dx = 0;
    let dy = 0;
    for (const code of this.down) {
      const m = MOVE_CODES[code];
      if (m) {
        dx += m.dx;
        dy += m.dy;
      }
    }
    dx = Math.max(-1, Math.min(1, dx));
    dy = Math.max(-1, Math.min(1, dy));

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

    const thr = this.throwPulse;
    this.throwPulse = 0;
    const use = this.usePulse;
    this.usePulse = false;

    return {
      dx,
      dy,
      aim,
      fire: this.mouseDown || this.touchAim.firing || this.down.has("Space"),
      sprint: this.down.has("ShiftLeft") || this.down.has("ShiftRight"),
      use,
      weapon: this.weapon,
      throw: thr,
    };
  }
}
