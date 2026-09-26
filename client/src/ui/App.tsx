import { useCallback, useEffect, useRef, useState } from "react";
import {
  enterGameFullscreen,
  exitGameFullscreen,
  isMobileViewport,
} from "../game/fullscreen";
import { GameClient, type GameHud } from "../game/loop";
import { CloudTransport } from "../net/cloudTransport";
import { LanClientTransport, httpToWs } from "../net/lanTransport";
import { LoopbackTransport } from "../net/loopbackTransport";
import {
  autoSelectMode,
  overrideWarning,
  recommendMode,
  type GameMode,
  type ModeOverride,
} from "../net/modeSelector";
import type { Transport } from "../net/transport";
import { Hud } from "./Hud";
import { Lobby, type LobbyAction } from "./Lobby";
import { LoadingScreen } from "./LoadingScreen";
import { TouchControls } from "./TouchControls";
import {
  getGraphicsQuality,
  setGraphicsQuality,
  type GraphicsQuality,
} from "../game/graphics";
import { preloadArt } from "../game/art";
import { loadMyLook, saveMyLook } from "../game/lookStore";
import type { Look } from "../../../shared/cosmetics";
import { Wardrobe } from "./Wardrobe";
import { preloadSfx, unlockAudio } from "../game/audio";

/** Host do Party: env, senão o mesmo IP da página (celular na LAN), senão localhost. */
function resolvePartyHost(): string {
  if (import.meta.env.VITE_PARTY_HOST) return import.meta.env.VITE_PARTY_HOST;
  if (typeof location !== "undefined") {
    const h = location.hostname;
    if (h && h !== "localhost" && h !== "127.0.0.1") {
      return `${h}:1999`;
    }
  }
  return "localhost:1999";
}

function regionPingUrls(): Record<string, string> {
  const host = resolvePartyHost();
  return {
    "São Paulo":
      import.meta.env.VITE_PING_GRU || `http://${host}/ping`,
    "US East": import.meta.env.VITE_PING_IAD || `http://${host}/ping`,
    Europe: import.meta.env.VITE_PING_AMS || `http://${host}/ping`,
  };
}

function randomRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<GameClient | null>(null);
  const [screen, setScreen] = useState<"lobby" | "game">("lobby");
  const [hud, setHud] = useState<GameHud | null>(null);
  const [recommendation, setRecommendation] = useState<GameMode | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [lastOverride, setLastOverride] = useState<ModeOverride>("auto");
  const [hostInfoUrl, setHostInfoUrl] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [masterVol, setMasterVol] = useState(0.85);
  const [mobileUi, setMobileUi] = useState(() => isMobileViewport());
  const [graphicsQuality, setGraphicsQualityState] = useState<GraphicsQuality>(() =>
    getGraphicsQuality(),
  );
  const [loadProgress, setLoadProgress] = useState(0);
  const [assetsReady, setAssetsReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const [look, setLook] = useState<Look>(() => loadMyLook());
  const [wardrobeOpen, setWardrobeOpen] = useState(false);

  const saveLook = useCallback((l: Look) => {
    const clean = saveMyLook(l);
    setLook(clean);
    clientRef.current?.setLook(clean);
    setWardrobeOpen(false);
  }, []);

  // Preload real (art 70% + sfx 30%) antes do menu — elimina hitch de estreia
  useEffect(() => {
    let alive = true;
    const started = performance.now();
    const MIN_MS = 400;
    (async () => {
      let a = 0;
      let s = 0;
      const bump = () => {
        if (!alive) return;
        setLoadProgress(0.7 * a + 0.3 * s);
      };
      try {
        await Promise.all([
          preloadArt((l, t) => {
            a = t ? l / t : 1;
            bump();
          }),
          preloadSfx((l, t) => {
            s = t ? l / t : 1;
            bump();
          }),
        ]);
      } catch {
        /* fallback procedural / synth — segue */
      }
      const left = MIN_MS - (performance.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      if (alive) {
        setLoadProgress(1);
        setAssetsReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const changeGraphics = useCallback((q: GraphicsQuality) => {
    setGraphicsQuality(q);
    setGraphicsQualityState(q);
    clientRef.current?.setGraphicsQuality(q);
  }, []);

  useEffect(() => {
    const onViewport = () => setMobileUi(isMobileViewport());
    onViewport();
    window.addEventListener("resize", onViewport);
    return () => window.removeEventListener("resize", onViewport);
  }, []);

  // mobile + playing: canvas preenche o arena-wrap (tela toda)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.dataset.fill = mobileUi && hud?.phase === "playing" ? "1" : "0";
    window.dispatchEvent(new Event("resize"));
  }, [mobileUi, hud?.phase, screen]);

  const goFullscreen = useCallback(async () => {
    if (!isMobileViewport()) return;
    await enterGameFullscreen(shellRef.current);
  }, []);

  useEffect(() => {
    // se a página veio do host LAN, captura info
    if (location.port === "8787" || location.hostname.match(/^192\.168\./)) {
      setHostInfoUrl(location.origin);
      fetch("/host-info")
        .then((r) => r.json())
        .then((j: { url?: string }) => {
          if (j.url) setHostInfoUrl(j.url);
        })
        .catch(() => {});
    }
  }, []);

  const onMeasure = useCallback(async () => {
    setMeasuring(true);
    try {
      const mode = await autoSelectMode({
        probeSignaling: null, // sem peers ainda no lobby solo
        isInitiator: true,
        regionPingUrls: regionPingUrls(),
        exchangeRegionRtts: async (mine) => [mine],
      });
      setRecommendation(mode);
      setWarning(overrideWarning(mode, lastOverride));
    } catch {
      setRecommendation(
        recommendMode({
          lan: null,
          regionRtts: { "São Paulo": 40 },
        }),
      );
    } finally {
      setMeasuring(false);
    }
  }, [lastOverride]);

  const leave = useCallback(() => {
    clientRef.current?.stop();
    clientRef.current = null;
    setHud(null);
    setScreen("lobby");
    void exitGameFullscreen();
  }, []);

  const boot = useCallback(async (transport: Transport, name: string) => {
    clientRef.current?.stop();
    clientRef.current = null;
    setHud(null);
    setScreen("game");
    await goFullscreen();

    // espera o shell ficar visível antes de medir o canvas
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    const canvas = canvasRef.current;
    if (!canvas) {
      setHud({
        phase: "error",
        ping: 0,
        lobby: null,
        welcome: null,
        snapshot: null,
        selfHp: 100,
        stamina: 100,
        weaponName: "Pistola",
        mag: 0,
        reserve: 0,
        reloadProgress: 0,
        abilityName: "Jato de Água",
        abilityCd: 1,
        abilityCdMs: 6000,
        stunned: false,
        error: "Canvas não disponível",
      });
      return;
    }

    const client = new GameClient({ transport, canvas, name });
    clientRef.current = client;
    client.onHud(setHud);
    try {
      await client.start();
    } catch (e) {
      setHud({
        phase: "error",
        ping: 0,
        lobby: null,
        welcome: null,
        snapshot: null,
        selfHp: 100,
        stamina: 100,
        weaponName: "Pistola",
        mag: 0,
        reserve: 0,
        reloadProgress: 0,
        abilityName: "Jato de Água",
        abilityCd: 1,
        abilityCdMs: 6000,
        stunned: false,
        error: e instanceof Error ? e.message : "falha ao conectar",
      });
    }
  }, [goFullscreen]);

  const onAction = useCallback(
    async (a: LobbyAction) => {
      if ("override" in a) {
        setLastOverride(a.override);
        if (recommendation) setWarning(overrideWarning(recommendation, a.override));
      }

      if (a.type === "online_create" || a.type === "online_join") {
        const preferOffline =
          a.override === "force_offline" ||
          (a.override === "auto" && recommendation?.kind === "offline_lan");
        if (preferOffline && a.override !== "force_online") {
          // recomenda ir pro fluxo local
          setWarning(
            "Recomendado: offline na mesma rede. Use Jogar local, ou force online.",
          );
          if (a.override === "force_offline") return;
        }

        const room =
          a.type === "online_join" ? a.code : randomRoomCode();
        const region =
          a.type === "online_create"
            ? a.region
            : recommendation && "region" in recommendation
              ? recommendation.region
              : undefined;
        const t = new CloudTransport({
          host: resolvePartyHost(),
          room,
          region: region === "auto" ? undefined : region,
        });
        await boot(t, a.name);
        return;
      }

      if (a.type === "lan_host") {
        // assume local-host já rodando; conecta ao próprio origin ou localhost:8787
        const base =
          location.port === "8787"
            ? location.origin
            : `http://${location.hostname === "localhost" ? "127.0.0.1" : location.hostname}:8787`;
        setHostInfoUrl(base);
        const t = new LanClientTransport(httpToWs(base));
        await boot(t, a.name);
        return;
      }

      if (a.type === "lan_join") {
        let url = a.url.trim();
        if (!/^wss?:\/\//i.test(url)) {
          if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
          url = httpToWs(url);
        }
        const t = new LanClientTransport(url);
        await boot(t, a.name);
        return;
      }

      if (a.type === "practice") {
        await boot(new LoopbackTransport({ bots: true, mode: 0 }), a.name);
      }
      if (a.type === "coop") {
        await boot(new LoopbackTransport({ bots: true, mode: 1 }), a.name);
      }
    },
    [boot, recommendation],
  );

  return (
    <div className="screen">
      {!entered && (
        <LoadingScreen
          progress={loadProgress}
          ready={assetsReady}
          onEnter={() => {
            unlockAudio();
            setEntered(true);
          }}
        />
      )}

      {entered && screen === "lobby" && (
        <Lobby
          onAction={onAction}
          recommendation={recommendation}
          measuring={measuring}
          onMeasure={onMeasure}
          warning={warning}
          hostInfoUrl={hostInfoUrl}
          graphicsQuality={graphicsQuality}
          onGraphicsQuality={changeGraphics}
          onOpenWardrobe={() => setWardrobeOpen(true)}
        />
      )}

      {wardrobeOpen && (
        <Wardrobe look={look} onSave={saveLook} onClose={() => setWardrobeOpen(false)} />
      )}

      <div
        ref={shellRef}
        className={`game-shell${mobileUi ? " mobile" : ""}${mobileUi && hud?.phase === "playing" ? " is-playing" : ""}`}
        style={{ display: entered && screen === "game" ? "flex" : "none" }}
      >
        {hud && (
          <Hud
            hud={hud}
            mobile={mobileUi}
            onStart={() => {
              void goFullscreen();
              clientRef.current?.startMatch();
              // remedir canvas pra ocupar a tela toda
              requestAnimationFrame(() => {
                if (canvasRef.current) {
                  canvasRef.current.dataset.fill = mobileUi ? "1" : "0";
                  window.dispatchEvent(new Event("resize"));
                }
              });
            }}
            onRematch={() => {
              void goFullscreen();
              clientRef.current?.startMatch();
            }}
            onLeave={leave}
            muted={muted}
            masterVol={masterVol}
            onMuteToggle={() => {
              const next = !muted;
              setMuted(next);
              clientRef.current?.setMuted(next);
            }}
            onVolume={(v) => {
              setMasterVol(v);
              clientRef.current?.setVolume(v);
            }}
            graphicsQuality={graphicsQuality}
            onGraphicsQuality={changeGraphics}
            onOpenWardrobe={() => setWardrobeOpen(true)}
          />
        )}
        <div className="arena-wrap">
          {/* width/height só via JS — atributo React apaga o bitmap a cada re-render */}
          <canvas
            ref={canvasRef}
            data-fill={mobileUi && hud?.phase === "playing" ? "1" : "0"}
          />
          {mobileUi && hud?.phase === "playing" && (
            <TouchControls
              client={clientRef.current}
              abilityName={hud.abilityName}
              abilityId={hud.abilityId}
              abilityCd={hud.abilityCd}
              stunned={hud.stunned}
              frozen={hud.frozen}
              weaponId={hud.snapshot?.players.find((p) => p.id === hud.welcome?.selfId)?.weapon ?? 0}
            />
          )}
        </div>
        {hud?.phase === "error" && (
          <div className="lobby-overlay">
            <div className="lobby-card stack">
              <h2 style={{ margin: 0 }}>Falha de conexão</h2>
              <p className="hint">{hud.error || "Não foi possível conectar ao host."}</p>
              <p className="hint">
                Online: suba o Worker (`npm run party`). Local: `npm run host`.
              </p>
              <button type="button" onClick={leave}>
                Voltar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
