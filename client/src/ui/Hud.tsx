import type { GameHud } from "../game/loop";

function pingClass(ms: number) {
  if (ms < 60) return "ok";
  if (ms < 120) return "warn";
  return "bad";
}

interface Props {
  hud: GameHud;
  onStart: () => void;
  onRematch?: () => void;
  onLeave: () => void;
  muted?: boolean;
  masterVol?: number;
  onMuteToggle?: () => void;
  onVolume?: (v: number) => void;
}

export function Hud({
  hud,
  onStart,
  onRematch,
  onLeave,
  muted = false,
  masterVol = 0.85,
  onMuteToggle,
  onVolume,
}: Props) {
  const players = hud.lobby?.players ?? hud.snapshot?.players.map((p) => ({
    id: p.id,
    name: `P${p.id + 1}`,
    ready: true,
    ping: hud.ping,
    kills: p.kills,
  })) ?? [];

  const self = hud.snapshot?.players.find((p) => p.id === hud.welcome?.selfId);
  const hp = Math.max(0, Math.min(100, self?.hp ?? hud.selfHp ?? 100));
  const isHost = hud.welcome?.isHost || hud.lobby?.hostId === hud.welcome?.selfId;
  const canStart = hud.lobby?.canStart && isHost;
  const timeLeft = hud.snapshot
    ? Math.ceil(hud.snapshot.matchLeftMs / 1000)
    : 0;
  const mm = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const ss = String(timeLeft % 60).padStart(2, "0");

  return (
    <>
      <div className="topbar">
        <div className="scoreboard">
          {(hud.snapshot?.players ?? []).map((p) => (
            <span key={p.id} className={p.id === hud.welcome?.selfId ? "me" : ""}>
              P{p.id + 1} {p.kills}
            </span>
          ))}
          {hud.phase === "playing" && (
            <span className="mono" style={{ color: "var(--sand)" }}>
              {mm}:{ss}
            </span>
          )}
        </div>
        <div className="row">
          {hud.welcome && (
            <span className="mono" style={{ color: "var(--muted)" }}>
              sala {hud.welcome.roomCode}
            </span>
          )}
          <span className={`ping ${pingClass(hud.ping)}`}>{hud.ping}ms</span>
          {onMuteToggle && (
            <button type="button" className="ghost" onClick={onMuteToggle}>
              {muted ? "som off" : "som"}
            </button>
          )}
          {onVolume && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={masterVol}
              onChange={(e) => onVolume(Number(e.target.value))}
              title="volume"
              style={{ width: 72 }}
            />
          )}
          <button type="button" className="ghost" onClick={onLeave}>
            Sair
          </button>
        </div>
      </div>

      {(hud.phase === "lobby" || hud.phase === "connecting") && (
        <div className="lobby-overlay">
          <div className="lobby-card stack">
            <h2 style={{ margin: 0 }}>Sala — aguardando</h2>
            <p className="hint">Máximo 3 jogadores. Host inicia com 2+.</p>
            <ul className="player-list">
              {players.map((p) => (
                <li key={p.id}>
                  <span>
                    {p.name}
                    {p.id === hud.lobby?.hostId ? " (host)" : ""}
                  </span>
                  <span className={`ping ${pingClass(p.ping)}`}>{p.ping}ms</span>
                </li>
              ))}
              {players.length === 0 && <li>Conectando…</li>}
            </ul>
            <button type="button" disabled={!canStart} onClick={onStart}>
              Iniciar
            </button>
          </div>
        </div>
      )}

      {hud.phase === "full" && (
        <div className="lobby-overlay">
          <div className="lobby-card stack">
            <h2 style={{ margin: 0 }}>Sala cheia</h2>
            <p className="hint">Cap rígido de 3 jogadores.</p>
            <button type="button" onClick={onLeave}>
              Voltar
            </button>
          </div>
        </div>
      )}

      {hud.phase === "result" && (
        <div className="lobby-overlay">
          <div className="lobby-card stack">
            <h2 style={{ margin: 0 }}>Fim de partida</h2>
            <ul className="player-list">
              {[...(hud.snapshot?.players ?? [])]
                .sort((a, b) => b.kills - a.kills)
                .map((p, i) => (
                  <li key={p.id}>
                    <span>
                      #{i + 1} P{p.id + 1}
                    </span>
                    <span>{p.kills} kills</span>
                  </li>
                ))}
            </ul>
            {onRematch && (
              <button type="button" onClick={onRematch}>
                Revanche
              </button>
            )}
            <button type="button" className="ghost" onClick={onLeave}>
              Sair
            </button>
          </div>
        </div>
      )}

      {hud.phase === "playing" && (
        <div className="hud-bottom">
          <div className="hp-block">
            <div className="hp-label">integridade</div>
            <div className="hp-bar">
              <div className="hp-fill" style={{ width: `${Math.max(0, hp)}%` }} />
            </div>
            <div className="hp-label" style={{ marginTop: "0.4rem" }}>
              fôlego
            </div>
            <div className="hp-bar">
              <div
                className="hp-fill"
                style={{
                  width: `${Math.max(0, Math.min(100, hud.stamina ?? 100))}%`,
                  background: "linear-gradient(90deg, #2F5FD0, #5BB8E8)",
                }}
              />
            </div>
          </div>
          {self && !self.alive ? (
            <div className="hint mono" style={{ color: "var(--danger)" }}>
              abatido — respawn em instantes
            </div>
          ) : (
            <div className="hint mono" style={{ textAlign: "right" }}>
              <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>
                <span style={{ color: (hud.mag ?? 0) === 0 ? "var(--danger)" : "var(--giz)" }}>
                  {hud.mag ?? 0}
                </span>
                <span style={{ color: "var(--muted)" }}> / {hud.reserve ?? 0}</span>
              </div>
              <div>{hud.weaponName ?? "Pistola"} · 1-7 · R reload</div>
              {(hud.reloadProgress ?? 0) > 0 && (
                <div className="hp-bar" style={{ width: 120, marginLeft: "auto", marginTop: 4 }}>
                  <div
                    className="hp-fill"
                    style={{
                      width: `${Math.round((hud.reloadProgress ?? 0) * 100)}%`,
                      background: "linear-gradient(90deg, #E8A838, #C45C5C)",
                    }}
                  />
                </div>
              )}
              <div>shift · e porta · g/f/c/v throw</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
