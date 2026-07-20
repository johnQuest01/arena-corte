import { useEffect, useMemo, useState } from "react";

const TIPS = [
  "Carregando arsenal…",
  "Preparando a cidade…",
  "Acordando os zumbis…",
  "Afiando o corte…",
  "Calibrando o jato…",
  "Congelando o ar…",
  "Plantando espinhos…",
] as const;

interface Props {
  /** 0..1 progresso real do preload */
  progress: number;
  ready: boolean;
  onEnter: () => void;
}

/**
 * Tela de abertura — barra real + ENTRAR (desbloqueia áudio).
 * Paleta dust/corte/giz, Martian Mono no % e tip.
 */
export function LoadingScreen({ progress, ready, onEnter }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  const [tipIdx, setTipIdx] = useState(0);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (ready) return;
    const id = window.setInterval(() => {
      setTipIdx((i) => (i + 1) % TIPS.length);
    }, 1600);
    return () => clearInterval(id);
  }, [ready]);

  useEffect(() => {
    const id = window.setInterval(() => setPulse((p) => p + 1), 80);
    return () => clearInterval(id);
  }, []);

  const tip = useMemo(() => {
    if (ready) return "Pronto. O campo espera.";
    return TIPS[tipIdx]!;
  }, [ready, tipIdx]);

  // silhueta “skyline” procedural — leve, sem assets
  const skyline = useMemo(() => {
    const bars: { x: number; w: number; h: number }[] = [];
    let x = 4;
    let i = 0;
    while (x < 96) {
      const w = 3 + ((i * 7) % 5);
      const h = 18 + ((i * 13) % 42);
      bars.push({ x, w, h });
      x += w + 1.2;
      i++;
    }
    return bars;
  }, []);

  return (
    <div className="loading-screen" aria-busy={!ready} aria-live="polite">
      <div className="loading-bg" aria-hidden>
        <div className="loading-haze" />
        <div className="loading-scan" style={{ opacity: 0.12 + (pulse % 20) * 0.002 }} />
        <svg className="loading-skyline" viewBox="0 0 100 70" preserveAspectRatio="none">
          {skyline.map((b, i) => (
            <rect
              key={i}
              x={b.x}
              y={70 - b.h}
              width={b.w}
              height={b.h}
              fill={i % 3 === 0 ? "#1a2e28" : "#14221c"}
              opacity={0.85}
            />
          ))}
          <rect x="0" y="62" width="100" height="8" fill="#0c1410" />
        </svg>
        <div className="loading-vignette" />
      </div>

      <div className="loading-inner">
        <p className="loading-eyebrow mono">sistema · preload</p>
        <h1 className="loading-brand">
          ARENA <span>CORTE</span>
        </h1>
        <p className="loading-tag">Deathmatch top-down · 3 jogadores</p>

        <div className="loading-bar-wrap">
          <div className="loading-bar-meta">
            <span className="mono loading-tip">{tip}</span>
            <span className="mono loading-pct">{pct}%</span>
          </div>
          <div className="loading-bar-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div
              className={`loading-bar-fill${ready ? " ready" : ""}`}
              style={{ width: `${pct}%` }}
            />
            <div className="loading-bar-glint" style={{ left: `${Math.max(0, pct - 4)}%` }} />
          </div>
          <div className="loading-ticks mono" aria-hidden>
            <span>0</span>
            <span>50</span>
            <span>100</span>
          </div>
        </div>

        {ready ? (
          <button type="button" className="loading-enter" onClick={onEnter} autoFocus>
            ENTRAR
          </button>
        ) : (
          <p className="loading-wait mono">aguarde o arsenal…</p>
        )}
      </div>
    </div>
  );
}
