/**
 * modeSelector.ts — seção 6.5: auto-seleção de modo (sonda, não adivinha).
 */
import { openDataChannel, type Signaling } from "./webrtc";

export type GameMode =
  | { kind: "offline_lan"; reason: string; estimatedPingMs: number }
  | { kind: "online_same_region"; region: string; reason: string; estimatedPingMs: number }
  | { kind: "online_cross_region"; region: string; reason: string; estimatedPingMs: number };

export type ModeOverride = "auto" | "force_offline" | "force_online";

function median(xs: number[]): number {
  if (xs.length === 0) return Infinity;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

export function attachPingResponder(channel: RTCDataChannel): void {
  channel.addEventListener("message", (ev) => {
    if (typeof ev.data === "string" && ev.data.startsWith("ping:")) {
      channel.send("pong:" + ev.data.slice(5));
    }
  });
}

export function measureChannelRtt(channel: RTCDataChannel, samples = 6): Promise<number> {
  return new Promise((resolve) => {
    const times: number[] = [];
    const onMsg = (ev: MessageEvent) => {
      if (typeof ev.data === "string" && ev.data.startsWith("pong:")) {
        times.push(performance.now() - Number(ev.data.slice(5)));
        if (times.length >= samples) {
          channel.removeEventListener("message", onMsg);
          resolve(median(times));
        } else {
          channel.send("ping:" + performance.now());
        }
      }
    };
    channel.addEventListener("message", onMsg);
    channel.send("ping:" + performance.now());
  });
}

export async function inspectSelectedPair(
  pc: RTCPeerConnection,
): Promise<{ direct: boolean; localType?: string; remoteType?: string }> {
  const stats = await pc.getStats();
  let pair: RTCStats | undefined;
  stats.forEach((r) => {
    const any = r as RTCStats & { nominated?: boolean; state?: string };
    if (r.type === "candidate-pair" && any.nominated && any.state === "succeeded") pair = r;
  });
  if (!pair) return { direct: false };
  const p = pair as RTCStats & { localCandidateId?: string; remoteCandidateId?: string };
  const local = p.localCandidateId ? stats.get(p.localCandidateId) : undefined;
  const remote = p.remoteCandidateId ? stats.get(p.remoteCandidateId) : undefined;
  const lt = (local as { candidateType?: string } | undefined)?.candidateType;
  const rt = (remote as { candidateType?: string } | undefined)?.candidateType;
  const relayed = lt === "relay" || rt === "relay";
  return { direct: !relayed, localType: lt, remoteType: rt };
}

export async function probeLan(
  signaling: Signaling,
  initiator: boolean,
): Promise<{ direct: boolean; rttMs: number } | null> {
  try {
    const { pc, channel } = await withTimeout(
      openDataChannel(signaling, { initiator, label: "probe" }),
      5000,
    );

    let result: { direct: boolean; rttMs: number };
    if (initiator) {
      const rttMs = await withTimeout(measureChannelRtt(channel), 3000);
      const pair = await inspectSelectedPair(pc);
      result = { direct: pair.direct, rttMs };
    } else {
      attachPingResponder(channel);
      const pair = await inspectSelectedPair(pc);
      result = { direct: pair.direct, rttMs: Infinity };
    }

    setTimeout(() => pc.close(), 500);
    return result;
  } catch {
    return null;
  }
}

export async function measureRegionRtt(pingUrl: string, samples = 4): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    try {
      await fetch(pingUrl, { cache: "no-store", mode: "cors" });
    } catch {
      // no-cors fallback
      try {
        await fetch(pingUrl, { cache: "no-store", mode: "no-cors" });
      } catch {
        return Infinity;
      }
    }
    times.push(performance.now() - t0);
  }
  return median(times);
}

export function aggregateWorstCase(perPeer: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const peer of perPeer) {
    for (const [region, ms] of Object.entries(peer)) {
      out[region] = Math.max(out[region] ?? 0, ms);
    }
  }
  return out;
}

export function recommendMode(input: {
  lan: { direct: boolean; rttMs: number } | null;
  regionRtts: Record<string, number>;
  thresholds?: { lanMaxMs?: number; sameRegionMaxMs?: number };
}): GameMode {
  const lanMax = input.thresholds?.lanMaxMs ?? 15;
  const sameRegionMax = input.thresholds?.sameRegionMaxMs ?? 60;

  if (input.lan && input.lan.direct && input.lan.rttMs <= lanMax) {
    return {
      kind: "offline_lan",
      reason: "Vocês estão na mesma rede",
      estimatedPingMs: Math.round(input.lan.rttMs),
    };
  }

  const entries = Object.entries(input.regionRtts).filter(([, ms]) => Number.isFinite(ms));
  if (entries.length === 0) {
    return {
      kind: "online_cross_region",
      region: "auto",
      reason: "Não deu pra medir regiões; usando padrão",
      estimatedPingMs: 0,
    };
  }

  entries.sort((a, b) => a[1]! - b[1]!);
  const [bestRegion, bestMs] = entries[0]!;

  if (bestMs <= sameRegionMax) {
    return {
      kind: "online_same_region",
      region: bestRegion,
      reason: `Todos perto de ${bestRegion}`,
      estimatedPingMs: Math.round(bestMs),
    };
  }
  return {
    kind: "online_cross_region",
    region: bestRegion,
    reason: "Jogadores distantes — é a física da distância",
    estimatedPingMs: Math.round(bestMs),
  };
}

export function describeMode(m: GameMode): string {
  switch (m.kind) {
    case "offline_lan":
      return `Mesma rede → jogar offline (ping ~${m.estimatedPingMs}ms)`;
    case "online_same_region":
      return `${m.reason} → online (ping ~${m.estimatedPingMs}ms)`;
    case "online_cross_region":
      return `Jogadores distantes → online ${m.region} (ping ~${m.estimatedPingMs}ms; física da distância)`;
  }
}

/** Aviso leve se o host forçar um modo pior que o recomendado. */
export function overrideWarning(
  recommended: GameMode,
  override: ModeOverride,
): string | null {
  if (override === "auto") return null;
  if (override === "force_online" && recommended.kind === "offline_lan") {
    return "Vocês estão na mesma rede; offline teria ping menor";
  }
  if (override === "force_offline" && recommended.kind !== "offline_lan") {
    return "A sonda não confirmou LAN direta; offline pode falhar se não estiverem na mesma rede";
  }
  return null;
}

export async function autoSelectMode(deps: {
  probeSignaling: Signaling | null;
  isInitiator: boolean;
  regionPingUrls: Record<string, string>;
  exchangeRegionRtts: (mine: Record<string, number>) => Promise<Record<string, number>[]>;
  thresholds?: { lanMaxMs?: number; sameRegionMaxMs?: number };
}): Promise<GameMode> {
  const lan = deps.probeSignaling
    ? await probeLan(deps.probeSignaling, deps.isInitiator)
    : null;

  const mine: Record<string, number> = {};
  await Promise.all(
    Object.entries(deps.regionPingUrls).map(async ([region, url]) => {
      mine[region] = await measureRegionRtt(url);
    }),
  );
  const allPeers = await deps.exchangeRegionRtts(mine).catch(() => [mine]);
  const regionRtts = aggregateWorstCase(allPeers.length ? allPeers : [mine]);

  return recommendMode({ lan, regionRtts, thresholds: deps.thresholds });
}
