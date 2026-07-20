import { KILL_FEED_MS, playerTag, type KillFeedEntry } from "../game/feedback";
import type { GraphicsQuality } from "../game/graphics";
import type { GameHud } from "../game/loop";
import { GraphicsToggle } from "./GraphicsToggle";

function pingClass(ms: number) {
  if (ms < 60) return "ok";
  if (ms < 120) return "warn";
  return "bad";
}

function killFeedLine(e: KillFeedEntry, selfId: number | undefined) {
  const vic = playerTag(e.victimId);
  if (e.solo) return { text: `${vic} morreu`, you: false, youVictim: e.victimId === selfId };
  if (e.youKill) return { text: `Você eliminou ${vic}`, you: true, youVictim: false };
  const kil = playerTag(e.killerId);
  return {
    text: `${kil}  ${e.label}  ${vic}`,
    you: e.killerId === selfId,
    youVictim: e.victimId === selfId,
  };
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
  mobile?: boolean;
  graphicsQuality?: GraphicsQuality;
  onGraphicsQuality?: (q: GraphicsQuality) => void;
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
  mobile = false,
  graphicsQuality,
  onGraphicsQuality,
}: Props) {
  const players = hud.lobby?.players ?? hud.snapshot?.players.map((p) => ({
    id: p.id,
    name: `P${p.id + 1}`,
    ready: true,
    ping: hud.ping,
    kills: p.kills,
  })) ?? [];

  const self = hud.snapshot?.players.find((p) => p.id === hud.welcome?.selfId);
  const selfId = hud.welcome?.selfId;
  const hp = Math.max(0, Math.min(100, self?.hp ?? hud.selfHp ?? 100));
  // qualquer um pode iniciar com 2+ na sala
  const canStart = !!hud.lobby?.canStart;
  const nowMs = hud.nowMs ?? performance.now();
  const feed = hud.killFeed ?? [];
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
          {hud.phase === "playing" && (hud.mode ?? 0) === 1 && (
            <span className="mono" style={{ color: "var(--giz)" }}>
              Onda {hud.wave ?? 0} · resta {hud.waveLeft ?? 0} · vivos {hud.playersAlive ?? 0}
              {hud.bossAlive ? " · BRUTAMONTES!" : ""}
            </span>
          )}
          {hud.phase === "playing" && (hud.mode ?? 0) !== 1 && (
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
          {graphicsQuality && onGraphicsQuality && (mobile || hud.phase === "lobby") && (
            <GraphicsToggle
              quality={graphicsQuality}
              onChange={onGraphicsQuality}
              hint={false}
              compact
            />
          )}
          {!mobile && onVolume && (
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
            <h2 style={{ margin: 0 }}>
              Sala — {(hud.lobby?.mode ?? hud.welcome?.mode) === 1 ? "Survival Zumbis" : "aguardando"}
            </h2>
            <p className="hint">
              {(hud.lobby?.mode ?? hud.welcome?.mode) === 1
                ? "Ondas de zumbis. Brutamontes entra a partir da onda 2. Fogo amigo LIGADO."
                : "Máximo 3 jogadores. Com 2 ou 3 na sala, qualquer um pode iniciar."}
            </p>
            {hud.welcome?.roomCode && (
              <p className="mono" style={{ fontSize: "1.35rem", letterSpacing: "0.12em", margin: 0 }}>
                código {hud.welcome.roomCode}
              </p>
            )}
            <ul className="player-list">
              {players.map((p) => (
                <li key={p.id}>
                  <span>
                    {p.name}
                    {p.id === hud.lobby?.hostId ? " (host)" : ""}
                    {p.id === hud.welcome?.selfId ? " — você" : ""}
                  </span>
                  <span className={`ping ${pingClass(p.ping)}`}>{p.ping}ms</span>
                </li>
              ))}
              {players.length === 0 && <li>Conectando…</li>}
            </ul>
            <p className="hint">{players.length}/3 na sala</p>
            {graphicsQuality && onGraphicsQuality && (
              <GraphicsToggle quality={graphicsQuality} onChange={onGraphicsQuality} />
            )}
            <button type="button" disabled={!canStart} onClick={onStart}>
              {canStart ? "Iniciar" : "Aguardando 2+ jogadores"}
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

      {hud.phase === "playing" && feed.length > 0 && (
        <div className="kill-feed" aria-live="polite">
          {feed.map((e) => {
            const age = nowMs - e.at;
            const fade = Math.max(0, Math.min(1, 1 - age / KILL_FEED_MS));
            const line = killFeedLine(e, selfId);
            return (
              <div
                key={e.id}
                className={`kill-feed-line${line.you ? " you-kill" : ""}${line.youVictim ? " you-victim" : ""}`}
                style={{ opacity: fade }}
              >
                {line.you ? (
                  <span className="kf-you">{line.text}</span>
                ) : e.solo ? (
                  <span className="kf-victim">{line.text}</span>
                ) : (
                  <>
                    <span className={e.killerId === selfId ? "kf-you" : "kf-name"}>
                      {playerTag(e.killerId)}
                    </span>
                    <span className="kf-cause">{e.label}</span>
                    <span className={e.victimId === selfId ? "kf-victim" : "kf-name"}>
                      {playerTag(e.victimId)}
                    </span>
                  </>
                )}
              </div>
            );
          })}
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
              <div>{hud.weaponName ?? "Pistola"}</div>
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
              {!mobile && (
                <>
                  <div className="ability-hud" title={hud.abilityName ?? "Jato de Água"}>
                    <div
                      className={`ability-icon${(hud.abilityCd ?? 1) < 1 ? " cooling" : ""}${hud.stunned || hud.frozen ? " stunned" : ""}`}
                      style={{ ["--cd" as string]: String(1 - (hud.abilityCd ?? 1)) }}
                    >
                      <span className="ability-glyph">
                        {(hud.abilityName ?? "").includes("Congelamento")
                          ? "❄"
                          : (hud.abilityName ?? "").includes("Espinhos")
                          ? "E"
                          : (hud.abilityName ?? "").includes("Bomba")
                            ? "D"
                            : (hud.abilityName ?? "").includes("Fenda")
                              ? "F"
                              : (hud.abilityName ?? "").includes("Recuo")
                                ? "R"
                                : (hud.abilityName ?? "").includes("Capa")
                                  ? "C"
                                  : (hud.abilityName ?? "").includes("Botas")
                                    ? "B"
                                    : (hud.abilityName ?? "").includes("Gigante")
                                      ? "G"
                                      : "W"}
                      </span>
                      <span className="ability-key">Q</span>
                    </div>
                    <div className="ability-meta">
                      {(hud.abilityName ?? "").includes("Recuo") && (
                        <div className="ability-pips" aria-label="cargas">
                          {[0, 1].map((i) => {
                            const charges = hud.dashCharges ?? 2;
                            const fill =
                              i < charges
                                ? 1
                                : i === charges
                                  ? hud.dashRecharge ?? 0
                                  : 0;
                            return (
                              <span
                                key={i}
                                className={`ability-pip${fill >= 1 ? " full" : fill > 0 ? " charging" : ""}`}
                                style={{ ["--pip" as string]: String(fill) }}
                              />
                            );
                          })}
                        </div>
                      )}
                      <div className="ability-label mono">
                        {hud.abilityName ?? "Jato"}
                        {(hud.abilityName ?? "").includes("Recuo")
                          ? (hud.dashCharges ?? 0) > 0
                            ? ` ${hud.dashCharges}/2`
                            : ` ${Math.ceil(((1 - (hud.dashRecharge ?? 0)) * (hud.abilityCdMs ?? 8000)) / 1000)}s`
                          : (hud.abilityCd ?? 1) < 1
                            ? ` ${Math.ceil(((1 - (hud.abilityCd ?? 1)) * (hud.abilityCdMs ?? 6000)) / 1000)}s`
                            : " pronta"}
                      </div>
                    </div>
                  </div>
                  <div>1-7 arma · R reload · Q poder · T troca · shift sprint</div>
                </>
              )}
              {mobile && (
                <div className="ability-label mono" style={{ marginTop: 4 }}>
                  {hud.abilityName ?? "Jato"}
                  {(hud.abilityName ?? "").includes("Recuo")
                    ? (hud.dashCharges ?? 0) > 0
                      ? ` ${hud.dashCharges}/2`
                      : ` ${Math.ceil(((1 - (hud.dashRecharge ?? 0)) * (hud.abilityCdMs ?? 8000)) / 1000)}s`
                    : (hud.abilityCd ?? 1) < 1
                      ? ` ${Math.ceil(((1 - (hud.abilityCd ?? 1)) * (hud.abilityCdMs ?? 6000)) / 1000)}s`
                      : " pronta"}
                  {(hud.abilityName ?? "").includes("Recuo") && (
                    <div className="ability-pips" style={{ marginTop: 4, justifyContent: "flex-end" }}>
                      {[0, 1].map((i) => {
                        const charges = hud.dashCharges ?? 2;
                        const fill =
                          i < charges ? 1 : i === charges ? hud.dashRecharge ?? 0 : 0;
                        return (
                          <span
                            key={i}
                            className={`ability-pip${fill >= 1 ? " full" : fill > 0 ? " charging" : ""}`}
                            style={{ ["--pip" as string]: String(fill) }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
