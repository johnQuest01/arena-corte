/** Fullscreen / landscape helpers pra mobile. */

export function isTouchPrimary(): boolean {
  if (typeof window === "undefined") return false;
  // celular/tablet: sem hover de mouse + ponteiro grosso
  // (PC com touchscreen + mouse continua no modo desktop)
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

export function isMobileViewport(): boolean {
  return isTouchPrimary();
}

export async function enterGameFullscreen(el?: HTMLElement | null): Promise<boolean> {
  const target = el ?? document.documentElement;
  try {
    if (!document.fullscreenElement && target.requestFullscreen) {
      await target.requestFullscreen({ navigationUI: "hide" });
    }
  } catch {
    /* usuário negou / iOS Safari sem Fullscreen API */
  }

  // iOS / fallback: trava orientação se possível
  try {
    const orient = screen.orientation as ScreenOrientation & {
      lock?: (mode: string) => Promise<void>;
    };
    if (orient?.lock) await orient.lock("landscape");
  } catch {
    /* ignore */
  }

  // scroll lock visual viewport
  document.documentElement.classList.add("game-fullscreen");
  document.body.classList.add("game-fullscreen");
  // força o canvas a remedir
  window.dispatchEvent(new Event("resize"));
  return !!document.fullscreenElement;
}

export async function exitGameFullscreen(): Promise<void> {
  document.documentElement.classList.remove("game-fullscreen");
  document.body.classList.remove("game-fullscreen");
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* ignore */
  }
  try {
    const orient = screen.orientation as ScreenOrientation & { unlock?: () => void };
    orient?.unlock?.();
  } catch {
    /* ignore */
  }
}
