/**
 * feedback.ts — kill feed + labels de causa (client-only).
 */
import { weaponOf } from "../../../shared/gear";

export const KILL_FEED_CAP = 5;
export const KILL_FEED_MS = 5000;
export const DMG_ARROW_MS = 800;
export const HITMARKER_MS = 120;

export interface KillFeedEntry {
  id: number;
  killerId: number;
  victimId: number;
  cause: number;
  at: number;
  /** rótulo curto da causa */
  label: string;
  /** killer === self */
  youKill: boolean;
  /** sem killer válido / auto → "P n morreu" */
  solo: boolean;
}

export interface DmgArrow {
  angle: number;
  at: number;
}

let feedSeq = 1;

export function playerTag(id: number): string {
  return `P${(id | 0) + 1}`;
}

export function isValidPlayerId(id: number): boolean {
  return Number.isFinite(id) && id >= 0 && id < 32 && id !== 255 && id !== 254;
}

/** Traduz weaponId/causa do evento death/hit. */
export function causeLabel(cause: number): string {
  const c = cause | 0;
  if (c === 100) return "granada";
  if (c === 101) return "fogo";
  if (c === 102) return "fenda";
  if (c === 103) return "bomba";
  if (c === 104) return "totem";
  if (c === 105) return "escudo";
  if (c === 106) return "raio";
  if (c === 200) return "zumbi";
  if (c === 201) return "gigante";
  if (c >= 0 && c <= 6) {
    const n = weaponOf(c).name;
    // nomes curtos pro feed
    if (n === "Pistola") return "pistola";
    if (n === "Shotgun") return "shotgun";
    if (n === "Sniper") return "sniper";
    return n.toLowerCase();
  }
  return "tiro";
}

export function pushKillFeed(
  feed: KillFeedEntry[],
  opts: {
    killerId: number;
    victimId: number;
    cause: number;
    selfId: number;
    at: number;
    forceGiant?: boolean;
  },
): KillFeedEntry[] {
  const cause = opts.forceGiant ? 201 : opts.cause;
  const suicide = opts.killerId === opts.victimId;
  const noKiller = !isValidPlayerId(opts.killerId);
  const solo = suicide || noKiller;
  const entry: KillFeedEntry = {
    id: feedSeq++,
    killerId: opts.killerId,
    victimId: opts.victimId,
    cause,
    at: opts.at,
    label: causeLabel(cause),
    youKill: !solo && opts.killerId === opts.selfId,
    solo,
  };
  const next = [entry, ...feed].slice(0, KILL_FEED_CAP);
  return next;
}

export function pruneKillFeed(feed: KillFeedEntry[], now: number): KillFeedEntry[] {
  return feed.filter((e) => now - e.at < KILL_FEED_MS);
}

export function pruneDmgArrows(arrows: DmgArrow[], now: number): DmgArrow[] {
  return arrows.filter((a) => now - a.at < DMG_ARROW_MS);
}
