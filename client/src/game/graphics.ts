/**
 * Qualidade gráfica — preferência do usuário (localStorage).
 * No mobile o padrão é "performance"; "full" libera metaballs, partículas e chão em 1×.
 */
import { applyMobileFxBudget } from "./abilities_fx";
import { invalidateGroundCache } from "./render";

export type GraphicsQuality = "performance" | "full";

const KEY = "arena-corte-graphics";

export function isTouchLikeDevice(): boolean {
  if (typeof window === "undefined") return false;
  const coarse =
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const touchSmall =
    (navigator.maxTouchPoints ?? 0) > 1 &&
    Math.min(window.innerWidth, window.innerHeight) < 1100;
  return coarse || touchSmall;
}

export function getGraphicsQuality(): GraphicsQuality {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "full" || v === "performance") return v;
  } catch {
    /* private mode */
  }
  return isTouchLikeDevice() ? "performance" : "full";
}

export function setGraphicsQuality(q: GraphicsQuality): GraphicsQuality {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    /* ignore */
  }
  applyGraphicsQuality(q);
  return q;
}

/** Aplica FX + força rebuild do chão na próxima frame. */
export function applyGraphicsQuality(q: GraphicsQuality = getGraphicsQuality()) {
  applyMobileFxBudget(q === "performance");
  invalidateGroundCache();
}
