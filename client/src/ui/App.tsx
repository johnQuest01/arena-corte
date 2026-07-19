import { useCallback, useEffect, useRef, useState } from "react";
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

const PARTY_HOST =
  import.meta.env.VITE_PARTY_HOST || "localhost:1999";

const REGION_PINGS: Record<string, string> = {
  "São Paulo":
    import.meta.env.VITE_PING_GRU || `http://${PARTY_HOST}/ping`,
  "US East": import.meta.env.VITE_PING_IAD || `http://${PARTY_HOST}/ping`,
  Europe: import.meta.env.VITE_PING_AMS || `http://${PARTY_HOST}/ping`,
};

function randomRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<GameClient | null>(null);
  const [screen, setScreen] = useState<"lobby" | "game">("lobby");
  const [hud, setHud] = useState<GameHud | null>(null);
  const [recommendation, setRecommendation] = useState<GameMode | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [lastOverride, setLastOverride] = useState<ModeOverride>("auto");
  const [hostInfoUrl, setHostInfoUrl] = useState<string | null>(null);

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
        regionPingUrls: REGION_PINGS,
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
  }, []);

  const boot = useCallback(async (transport: Transport, name: string) => {
    clientRef.current?.stop();
    clientRef.current = null;
    setHud(null);
    setScreen("game");

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
        error: e instanceof Error ? e.message : "falha ao conectar",
      });
    }
  }, []);

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
          host: PARTY_HOST,
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
        await boot(new LoopbackTransport({ bots: true }), a.name);
      }
    },
    [boot, recommendation],
  );

  return (
    <div className="screen">
      {screen === "lobby" && (
        <Lobby
          onAction={onAction}
          recommendation={recommendation}
          measuring={measuring}
          onMeasure={onMeasure}
          warning={warning}
          hostInfoUrl={hostInfoUrl}
        />
      )}

      <div className="game-shell" style={{ display: screen === "game" ? "flex" : "none" }}>
        {hud && (
          <Hud
            hud={hud}
            onStart={() => clientRef.current?.startMatch()}
            onRematch={() => clientRef.current?.startMatch()}
            onLeave={leave}
          />
        )}
        <div className="arena-wrap">
          {/* width/height só via JS — atributo React apaga o bitmap a cada re-render */}
          <canvas ref={canvasRef} />
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
