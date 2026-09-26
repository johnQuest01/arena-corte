import { useEffect, useRef, useState } from "react";
import {
  ARMORS,
  BODIES,
  BOOTS,
  CAPES,
  FX_STYLES,
  GUN_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  HELMETS,
  LOOK_KEYS,
  LOOK_SIZES,
  OUTFITS,
  PRESETS,
  SKIN_TONES,
  lookEquals,
  sanitizeLook,
  type Look,
  type LookKey,
} from "../../../shared/cosmetics";
import { renderLookPreview } from "../game/preview";

interface SlotItem {
  name: string;
  color?: string;
}

const SLOTS: { key: LookKey; label: string; items: SlotItem[] }[] = [
  { key: "outfit", label: "Roupa", items: OUTFITS.map((o) => ({ name: o.name, color: o.top })) },
  { key: "armor", label: "Armadura", items: ARMORS.map((a) => ({ name: a.name, color: a.main || undefined })) },
  { key: "boots", label: "Calçado", items: BOOTS.map((b) => ({ name: b.name, color: b.main })) },
  { key: "cape", label: "Capa", items: CAPES.map((c) => ({ name: c.name, color: c.main || undefined })) },
  { key: "helmet", label: "Capacete", items: HELMETS.map((h) => ({ name: h.name, color: h.main || undefined })) },
  { key: "hair", label: "Cabelo", items: HAIR_STYLES },
  { key: "hairColor", label: "Cor do cabelo", items: HAIR_COLORS },
  { key: "skin", label: "Pele", items: SKIN_TONES },
  { key: "gun", label: "Armas", items: GUN_STYLES },
  { key: "fx", label: "Poderes", items: FX_STYLES },
  { key: "body", label: "Boneco", items: BODIES },
];

function randomLook(): Look {
  const out: Partial<Look> = {};
  for (const k of LOOK_KEYS) out[k] = Math.floor(Math.random() * LOOK_SIZES[k]);
  out.body = 0;
  out.gun = 0;
  out.fx = 0;
  // itens "Rascunho" (antigos) só se escolher de propósito
  if (out.boots === LOOK_SIZES.boots - 1) out.boots = 0;
  if ((out.cape ?? 0) >= LOOK_SIZES.cape - 2) out.cape = 1;
  return sanitizeLook(out);
}

function PresetThumb({ look }: { look: Look }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(64 * dpr);
    c.height = Math.round(80 * dpr);
    renderLookPreview(c, look, 900, { aim: Math.PI / 2 - 0.5, walking: false }, `thumb-${LOOK_KEYS.map((k) => look[k]).join(".")}`);
    // capa assenta depois de alguns passos
    let n = 0;
    const id = window.setInterval(() => {
      n++;
      renderLookPreview(c, look, 900 + n * 40, { aim: Math.PI / 2 - 0.5, walking: false }, `thumb-${LOOK_KEYS.map((k) => look[k]).join(".")}`);
      if (n > 20) window.clearInterval(id);
    }, 40);
    return () => window.clearInterval(id);
  }, [look]);
  return <canvas ref={ref} className="ward-thumb" />;
}

interface Props {
  look: Look;
  onSave: (look: Look) => void;
  onClose: () => void;
}

/** Guarda-roupa: escolhe skin inteira ou item por item (só visual). */
export function Wardrobe({ look, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Look>(look);
  const [tab, setTab] = useState<"skins" | LookKey>("skins");
  const [walking, setWalking] = useState(true);
  const [spin, setSpin] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draftRef = useRef(draft);
  const walkRef = useRef(walking);
  const spinRef = useRef(spin);
  const aimRef = useRef(Math.PI / 2);
  draftRef.current = draft;
  walkRef.current = walking;
  spinRef.current = spin;

  useEffect(() => {
    let raf = 0;
    let acc = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const c = canvasRef.current;
      if (c) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cw = Math.round(c.clientWidth * dpr);
        const chh = Math.round(c.clientHeight * dpr);
        if (cw > 0 && (c.width !== cw || c.height !== chh)) {
          c.width = cw;
          c.height = chh;
        }
        acc += t - last;
        if (spinRef.current && acc > 1300) {
          acc = 0;
          aimRef.current += Math.PI / 4;
        }
        renderLookPreview(c, draftRef.current, t, { aim: aimRef.current, walking: walkRef.current });
      }
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const set = (k: LookKey, v: number) => setDraft((d) => sanitizeLook({ ...d, [k]: v }));
  const turn = (dir: number) => {
    setSpin(false);
    aimRef.current += (dir * Math.PI) / 4;
  };
  const slot = SLOTS.find((s) => s.key === tab);
  const changed = !lookEquals(draft, look);

  return (
    <div className="lobby-overlay wardrobe-overlay" role="dialog" aria-label="Guarda-roupa">
      <div className="wardrobe">
        <div className="ward-head">
          <h2>Guarda-roupa</h2>
          <span className="hint">Só visual — não muda dano nem velocidade.</span>
        </div>
        <div className="ward-body">
          <div className="ward-stage">
            <canvas ref={canvasRef} className="ward-preview" onClick={() => setWalking((w) => !w)} />
            <div className="ward-stage-ctl">
              <button type="button" className="ghost" onClick={() => turn(-1)} aria-label="girar para a esquerda">
                ⟲
              </button>
              <button type="button" className="ghost" onClick={() => setWalking((w) => !w)}>
                {walking ? "parar" : "andar"}
              </button>
              <button type="button" className="ghost" onClick={() => turn(1)} aria-label="girar para a direita">
                ⟳
              </button>
            </div>
          </div>
          <div className="ward-panel">
            <div className="ward-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                className={tab === "skins" ? "on" : ""}
                onClick={() => setTab("skins")}
              >
                Skins
              </button>
              {SLOTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  className={tab === s.key ? "on" : ""}
                  onClick={() => setTab(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {tab === "skins" ? (
              <div className="ward-presets">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className={`ward-preset${lookEquals(p.look, draft) ? " on" : ""}`}
                    onClick={() => setDraft({ ...p.look })}
                    title={p.desc}
                  >
                    <PresetThumb look={p.look} />
                    <span className="ward-preset-name">{p.name}</span>
                    <span className="ward-preset-desc">{p.desc}</span>
                  </button>
                ))}
              </div>
            ) : slot ? (
              <div className="ward-items">
                {slot.items.map((it, i) => (
                  <button
                    key={it.name}
                    type="button"
                    className={`ward-chip${draft[slot.key] === i ? " on" : ""}`}
                    onClick={() => set(slot.key, i)}
                  >
                    {it.color ? <span className="ward-swatch" style={{ background: it.color }} /> : null}
                    {it.name}
                  </button>
                ))}
                {slot.key === "body" && (
                  <p className="hint" style={{ width: "100%" }}>
                    "Rascunho" usa o boneco antigo (sprite) com as capas, botas e escudo antigos.
                  </p>
                )}
                {slot.key === "gun" && (
                  <p className="hint" style={{ width: "100%" }}>
                    Só o desenho muda — dano, cadência, pente e alcance são os mesmos.
                  </p>
                )}
                {slot.key === "fx" && (
                  <p className="hint" style={{ width: "100%" }}>
                    Todos veem os seus poderes neste estilo. Só visual: o efeito no jogo é igual.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <div className="ward-actions">
          <button type="button" className="ghost" onClick={() => setDraft(randomLook())}>
            Aleatório
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" onClick={() => onSave(draft)} disabled={!changed}>
            Vestir
          </button>
        </div>
      </div>
    </div>
  );
}
