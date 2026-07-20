import type { GraphicsQuality } from "../game/graphics";

interface Props {
  quality: GraphicsQuality;
  onChange: (q: GraphicsQuality) => void;
  /** Mostra dica (útil no menu / sala). */
  hint?: boolean;
  compact?: boolean;
}

/** Seletor Leve ↔ Full — pensado pro mobile, mas serve em qualquer tela. */
export function GraphicsToggle({ quality, onChange, hint = true, compact = false }: Props) {
  return (
    <div className={`graphics-toggle${compact ? " compact" : ""}`}>
      <div className="graphics-toggle-row">
        {!compact && <span className="graphics-toggle-label">Gráficos</span>}
        <div className="graphics-seg" role="group" aria-label="Qualidade gráfica">
          <button
            type="button"
            className={quality === "performance" ? "active" : ""}
            onClick={() => onChange("performance")}
          >
            Leve
          </button>
          <button
            type="button"
            className={quality === "full" ? "active" : ""}
            onClick={() => onChange("full")}
          >
            Full
          </button>
        </div>
      </div>
      {hint && (
        <p className="hint graphics-hint">
          {quality === "full"
            ? "Full: partículas, água e mapa em alta — pode pesar no celular."
            : "Leve: mais fluido. Troque pra Full se o aparelho aguentar."}
        </p>
      )}
    </div>
  );
}
