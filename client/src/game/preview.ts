/**
 * preview.ts — boneco girando/andando no guarda-roupa (canvas pequeno).
 */
import { CAPES, type Look } from "../../../shared/cosmetics";
import { aimToDir8, drawDirFrame, getCharDirs } from "./art";
import { BODY_K, capeAnchor, CHAR_SCALE, drawBody, facingOf, LEGACY_K } from "./character";
import { drawCape, stepCape } from "./capes";

export interface PreviewState {
  aim: number;
  walking: boolean;
}

/** Desenha o visual centralizado no canvas (px do canvas). */
export function renderLookPreview(
  canvas: HTMLCanvasElement,
  look: Look,
  tMs: number,
  st: PreviewState,
  key = "preview",
) {
  const g = canvas.getContext("2d");
  if (!g) return;
  const w = canvas.width;
  const h = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  // piso
  const floor = g.createRadialGradient(w / 2, h * 0.78, 4, w / 2, h * 0.78, w * 0.55);
  floor.addColorStop(0, "rgba(120,150,110,0.55)");
  floor.addColorStop(1, "rgba(120,150,110,0)");
  g.fillStyle = floor;
  g.fillRect(0, 0, w, h);

  // enquadramento igual ao de antes da escala nova (boneco menor no mundo)
  const z = Math.min(w / 150, h / 190) / BODY_K;
  const px = w / 2;
  const py = h * 0.8;
  g.save();
  g.translate(px, py);
  g.scale(z, z);
  g.fillStyle = "rgba(10,12,10,0.35)";
  g.beginPath();
  g.ellipse(2, 10, 24, 8, 0, 0, Math.PI * 2);
  g.fill();

  if (look.body === 1) {
    // Rascunho: o sprite antigo
    const dirs = getCharDirs(0);
    if (dirs) {
      const d = aimToDir8(st.aim);
      const S = 112 * LEGACY_K;
      g.imageSmoothingEnabled = false;
      drawDirFrame(g, dirs, 0, d, -S / 2, -S * 0.62, S, S);
    } else {
      g.fillStyle = "#8a9a90";
      g.font = "12px sans-serif";
      g.textAlign = "center";
      g.fillText("sprite antigo", 0, -40);
    }
    g.restore();
    return;
  }

  const speed = st.walking ? 190 : 0;
  const cape = look.cape > 0 ? CAPES[look.cape] : null;
  const f = facingOf(st.aim);
  const a = capeAnchor(st.aim);
  // simula a capa em coordenadas locais do preview (anda "no lugar": vento simulado)
  if (cape) {
    const sway = st.walking ? Math.sin(tMs * 0.004) * 6 : 0;
    stepCape(key, a.x + sway, a.y, st.aim, tMs, { floorY: 8, scale: CHAR_SCALE });
    if (!f.back) drawCape(g, key, cape, { width: a.w });
  }
  drawBody(g, look, {
    aim: st.aim,
    speed,
    leanX: 0,
    t: tMs,
    frozen: false,
    seed: 3,
  });
  if (cape && f.back) drawCape(g, key, cape, { width: a.w });
  g.restore();
}
