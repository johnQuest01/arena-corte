/**
 * Layout 2-polegares (base COD Mobile / PUBG):
 * - Esq: joystick mover (fixo)
 * - Dir: stick mira/tiro + strip de armas acima + reload/poder ao lado
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { WEAPONS } from "../../../shared/gear";
import type { GameClient } from "../game/loop";

interface Props {
  client: GameClient | null;
  abilityName?: string;
  abilityCd?: number;
  stunned?: boolean;
  weaponId?: number;
}

type StickSide = "move" | "aim";

const WEAPON_SHORT = ["P", "M4", "M16", "AK", "SG", "SMG", "SR"] as const;

function clampStick(dx: number, dy: number, max: number) {
  const len = Math.hypot(dx, dy);
  if (len <= max || len < 1e-6) return { x: dx, y: dy, len };
  const s = max / len;
  return { x: dx * s, y: dy * s, len: max };
}

export function TouchControls({
  client,
  abilityName,
  abilityCd = 1,
  stunned,
  weaponId = 0,
}: Props) {
  const moveBase = useRef<HTMLDivElement>(null);
  const aimBase = useRef<HTMLDivElement>(null);
  const moveKnob = useRef<HTMLDivElement>(null);
  const aimKnob = useRef<HTMLDivElement>(null);
  const moveId = useRef<number | null>(null);
  const aimId = useRef<number | null>(null);
  const lastAim = useRef({ x: 1, y: 0 });
  const [activeWeapon, setActiveWeapon] = useState(weaponId);

  useEffect(() => {
    setActiveWeapon(weaponId);
  }, [weaponId]);

  useEffect(() => {
    client?.controls.setTouchUi(true);
    return () => {
      client?.controls.setTouchUi(false);
      client?.controls.setMove(0, 0, false);
      client?.controls.setAim(0, 0, false, false);
      client?.controls.setSprint(false);
    };
  }, [client]);

  const applyStick = useCallback(
    (side: StickSide, clientX: number, clientY: number) => {
      const base = side === "move" ? moveBase.current : aimBase.current;
      const knob = side === "move" ? moveKnob.current : aimKnob.current;
      if (!base || !knob || !client) return;
      const r = base.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const max = r.width * 0.34;
      const raw = clampStick(clientX - cx, clientY - cy, max);
      knob.style.transform = `translate(${raw.x}px, ${raw.y}px)`;
      const nx = raw.x / max;
      const ny = raw.y / max;
      if (side === "move") {
        const active = Math.hypot(nx, ny) > 0.12;
        client.controls.setMove(nx, ny, active);
        client.controls.setSprint(Math.hypot(nx, ny) > 0.85);
      } else {
        const active = Math.hypot(nx, ny) > 0.1;
        if (active) {
          lastAim.current = { x: nx, y: ny };
          client.controls.setAim(nx, ny, true, true);
        } else {
          // deadzone: mantém última mira, não atira
          client.controls.setAim(lastAim.current.x, lastAim.current.y, true, false);
        }
      }
    },
    [client],
  );

  const resetStick = useCallback(
    (side: StickSide) => {
      const knob = side === "move" ? moveKnob.current : aimKnob.current;
      if (knob) knob.style.transform = "translate(0px, 0px)";
      if (!client) return;
      if (side === "move") {
        client.controls.setMove(0, 0, false);
        client.controls.setSprint(false);
      } else {
        client.controls.setAim(lastAim.current.x, lastAim.current.y, true, false);
      }
    },
    [client],
  );

  const bindZone = useCallback(
    (side: StickSide, el: HTMLDivElement | null) => {
      if (!el) return;
      const idRef = side === "move" ? moveId : aimId;

      const onDown = (e: PointerEvent) => {
        if (idRef.current != null) return;
        e.preventDefault();
        idRef.current = e.pointerId;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        applyStick(side, e.clientX, e.clientY);
      };
      const onMove = (e: PointerEvent) => {
        if (idRef.current !== e.pointerId) return;
        e.preventDefault();
        applyStick(side, e.clientX, e.clientY);
      };
      const onUp = (e: PointerEvent) => {
        if (idRef.current !== e.pointerId) return;
        idRef.current = null;
        resetStick(side);
      };

      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
      return () => {
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
      };
    },
    [applyStick, resetStick],
  );

  useEffect(() => {
    const cleanMove = bindZone("move", moveBase.current);
    const cleanAim = bindZone("aim", aimBase.current);
    return () => {
      cleanMove?.();
      cleanAim?.();
    };
  }, [bindZone]);

  const pickWeapon = (id: number) => {
    client?.controls.setWeapon(id);
    setActiveWeapon(id);
  };

  const glyph = (abilityName ?? "").includes("Gigante") ? "G" : "W";
  const cooling = (abilityCd ?? 1) < 1;

  return (
    <div className="touch-controls" aria-hidden>
      {/* LEFT — move (COD: fixed joystick bottom-left) */}
      <div className="touch-left">
        <div className="touch-stick touch-stick-move" ref={moveBase}>
          <div className="touch-stick-ring" />
          <div className="touch-stick-knob" ref={moveKnob} />
          <span className="touch-stick-label">mover</span>
        </div>
      </div>

      {/* RIGHT — armas + ações + mira/tiro (COD/PUBG 2-thumb) */}
      <div className="touch-right">
        <div className="touch-weapon-strip">
          {WEAPONS.map((w, i) => (
            <button
              key={w.id}
              type="button"
              className={`touch-wpn${activeWeapon === i ? " on" : ""}`}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                pickWeapon(i);
              }}
              title={w.name}
            >
              {WEAPON_SHORT[i] ?? String(i + 1)}
            </button>
          ))}
        </div>

        <div className="touch-right-row">
          <div className="touch-side-btns">
            <button
              type="button"
              className={`touch-btn touch-btn-cast${cooling ? " cooling" : ""}${stunned ? " stunned" : ""}`}
              style={{ ["--cd" as string]: String(1 - (abilityCd ?? 1)) }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                client?.controls.cast();
              }}
            >
              <span className="touch-btn-glyph">{glyph}</span>
              <span className="touch-btn-sub">poder</span>
            </button>
            <button
              type="button"
              className="touch-btn"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                client?.controls.toggleAbility();
              }}
            >
              <span className="touch-btn-glyph">⇄</span>
              <span className="touch-btn-sub">hab</span>
            </button>
            <button
              type="button"
              className="touch-btn"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                client?.controls.reload();
              }}
            >
              <span className="touch-btn-glyph">R</span>
              <span className="touch-btn-sub">reload</span>
            </button>
          </div>

          <div className="touch-stick touch-stick-aim" ref={aimBase}>
            <div className="touch-stick-ring" />
            <div className="touch-stick-knob aim" ref={aimKnob} />
            <span className="touch-stick-label">mira · tiro</span>
          </div>
        </div>
      </div>
    </div>
  );
}
