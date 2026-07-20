import { useMemo, useState } from "react";
import type { ModeOverride } from "../net/modeSelector";
import { describeMode, type GameMode } from "../net/modeSelector";
import type { GraphicsQuality } from "../game/graphics";
import { GraphicsToggle } from "./GraphicsToggle";

export type LobbyAction =
  | { type: "online_create"; name: string; override: ModeOverride; region?: string }
  | { type: "online_join"; name: string; code: string; override: ModeOverride }
  | { type: "lan_host"; name: string }
  | { type: "lan_join"; name: string; url: string }
  | { type: "practice"; name: string }
  | { type: "coop"; name: string };

interface Props {
  onAction: (a: LobbyAction) => void;
  recommendation: GameMode | null;
  measuring: boolean;
  onMeasure: () => void;
  warning: string | null;
  hostInfoUrl?: string | null;
  graphicsQuality?: GraphicsQuality;
  onGraphicsQuality?: (q: GraphicsQuality) => void;
}

export function Lobby({
  onAction,
  recommendation,
  measuring,
  onMeasure,
  warning,
  hostInfoUrl,
  graphicsQuality,
  onGraphicsQuality,
}: Props) {
  const [name, setName] = useState(() => `p${Math.floor(Math.random() * 90 + 10)}`);
  const [code, setCode] = useState("");
  const [lanUrl, setLanUrl] = useState("");
  const [override, setOverride] = useState<ModeOverride>("auto");
  const [path, setPath] = useState<"pick" | "online" | "local">("pick");

  const recoText = useMemo(
    () => (recommendation ? describeMode(recommendation) : null),
    [recommendation],
  );

  const qrSrc = hostInfoUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(hostInfoUrl)}`
    : null;

  if (path === "pick") {
    return (
      <div className="hero-lobby">
        <div className="hero-inner">
          <h1 className="brand">
            Arena <span>Corte</span>
          </h1>
          <p className="tagline">
            Deathmatch top-down pra 3. Online global ou local na mesma rede — sem misturar.
          </p>

          <div className="panel stack">
            <h2>Como quer jogar</h2>
            <div className="mode-choice">
              <label>
                <input
                  type="radio"
                  name="ov"
                  checked={override === "auto"}
                  onChange={() => setOverride("auto")}
                />
                <span>
                  <strong>Automático (recomendado)</strong>
                  <br />
                  <span className="hint">O sistema sonda LAN e regiões e escolhe o melhor modo.</span>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="ov"
                  checked={override === "force_online"}
                  onChange={() => setOverride("force_online")}
                />
                <span>
                  <strong>Forçar online</strong>
                  <br />
                  <span className="hint">Nuvem mesmo se estiverem perto.</span>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="ov"
                  checked={override === "force_offline"}
                  onChange={() => setOverride("force_offline")}
                />
                <span>
                  <strong>Forçar offline (mesma rede)</strong>
                  <br />
                  <span className="hint">LAN direto; precisa estar no mesmo cômodo.</span>
                </span>
              </label>
            </div>

            <div className="row">
              <button type="button" onClick={onMeasure} disabled={measuring}>
                {measuring ? "Medindo…" : "Medir e recomendar"}
              </button>
            </div>
            {recoText && <p className="reco">{recoText}</p>}
            {warning && <div className="warn-soft">{warning}</div>}

            <label className="stack">
              <span className="hint">Seu nome</span>
              <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
            </label>

            {graphicsQuality && onGraphicsQuality && (
              <GraphicsToggle quality={graphicsQuality} onChange={onGraphicsQuality} />
            )}

            <div className="row">
              <button type="button" onClick={() => setPath("online")}>
                Jogar online
              </button>
              <button type="button" className="secondary" onClick={() => setPath("local")}>
                Jogar local (mesma rede)
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => onAction({ type: "practice", name: name || "player" })}
              >
                Treino PvP
              </button>
              <button
                type="button"
                onClick={() => onAction({ type: "coop", name: name || "player" })}
              >
                Co-op / Survival
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (path === "online") {
    return (
      <div className="hero-lobby">
        <div className="hero-inner">
          <h1 className="brand">
            Online <span>global</span>
          </h1>
          <p className="tagline">Criar sala por código ou entrar com o código do host.</p>
          <div className="panel stack">
            <label className="stack">
              <span className="hint">Nome</span>
              <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
            </label>
            <button
              type="button"
              onClick={() =>
                onAction({
                  type: "online_create",
                  name: name || "player",
                  override,
                  region:
                    recommendation && "region" in recommendation
                      ? recommendation.region
                      : undefined,
                })
              }
            >
              Criar sala
            </button>
            <div className="row">
              <input
                placeholder="código (6 letras)"
                value={code}
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) =>
                  setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))
                }
                style={{ flex: 1 }}
              />
              <button
                type="button"
                disabled={code.length !== 6}
                onClick={() =>
                  onAction({
                    type: "online_join",
                    name: name || "player",
                    code,
                    override,
                  })
                }
              >
                Entrar
              </button>
            </div>
            {code.length > 0 && code.length < 6 && (
              <p className="hint">Digite o código completo ({code.length}/6).</p>
            )}
            {warning && <div className="warn-soft">{warning}</div>}
            <button type="button" className="ghost" onClick={() => setPath("pick")}>
              Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="hero-lobby">
      <div className="hero-inner">
        <h1 className="brand">
          Local <span>LAN</span>
        </h1>
        <p className="tagline">
          Host no PC serve a página em HTTP + WebSocket. Sem internet. Ping de mesma sala.
        </p>
        <div className="panel stack">
          <label className="stack">
            <span className="hint">Nome</span>
            <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => onAction({ type: "lan_host", name: name || "player" })}
          >
            Hospedar nesta máquina
          </button>
          <p className="hint">
            Rode <span className="mono">npm run host</span> no PC. Depois abra a URL LAN neste
            navegador.
          </p>
          {hostInfoUrl && (
            <div className="qr-box">
              <span className="mono">{hostInfoUrl}</span>
              {qrSrc && <img src={qrSrc} alt="QR para entrar na sala local" />}
            </div>
          )}
          <div className="row">
            <input
              placeholder="http://192.168.0.10:8787"
              value={lanUrl}
              onChange={(e) => setLanUrl(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="secondary"
              disabled={!lanUrl}
              onClick={() =>
                onAction({ type: "lan_join", name: name || "player", url: lanUrl })
              }
            >
              Entrar no host
            </button>
          </div>
          <button type="button" className="ghost" onClick={() => setPath("pick")}>
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}
