/**
 * lookStore.ts — visual escolhido no guarda-roupa (persistido no navegador).
 */
import { DEFAULT_LOOK, sanitizeLook, type Look } from "../../../shared/cosmetics";

const KEY = "arena-corte-look";

export function loadMyLook(): Look {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeLook(JSON.parse(raw) as Partial<Look>);
  } catch {
    /* modo privado / JSON inválido */
  }
  return { ...DEFAULT_LOOK };
}

export function saveMyLook(look: Look): Look {
  const clean = sanitizeLook(look);
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* ignore */
  }
  return clean;
}
