"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  dropInRoom,
  ensureUser,
  isStubMode,
  listLobby,
  type LobbyEntry,
} from "@/lib/game";
import { getDropInSettings, getIdentity, type LocalIdentity } from "@/lib/session";

/**
 * Public lobby (BUILD_SPEC.md §3, §6.3, §7–§8).
 * Rooms come from the service layer; each is checked through the
 * bilateral rule (`canDropIn`) with this user's real personal settings.
 * Dropping in runs the full flow — policy check, situation-weighted
 * ally/boss roll, GM entrance staging — then routes to the room with a
 * "previously on" briefing card waiting.
 */
export default function LobbyPage() {
  const router = useRouter();
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [entries, setEntries] = useState<LobbyEntry[] | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const id = getIdentity();
    setIdentity(id);
    void (async () => {
      try {
        const settings = getDropInSettings();
        await ensureUser(id.uid, id.displayName, settings);
        setEntries(await listLobby(id.uid, settings));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the lobby");
      }
    })();
  }, []);

  async function dropIn(code: string) {
    if (!identity || busyCode) return;
    setBusyCode(code);
    setError(null);
    try {
      const result = await dropInRoom(code, identity.uid, identity.displayName, getDropInSettings());
      window.sessionStorage.setItem(
        `gm-briefing-${code}`,
        JSON.stringify({ form: result.form, text: result.briefing }),
      );
      router.push(`/room?code=${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drop-in failed");
      setBusyCode(null);
    }
  }

  const visible = (entries ?? []).filter((e) => e.check.ok);
  const blocked = (entries ?? []).filter((e) => !e.check.ok);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <h1 className="text-3xl font-bold">Public lobby</h1>
      <p className="mt-2 text-sm text-white/60">
        Games in progress that your settings allow you to drop into. You may arrive as an
        ally — or, if the moment is right, as the boss.
      </p>
      {isStubMode() && (
        <p className="mt-2 text-xs text-white/40">
          Local demo mode — Firebase is not configured, so these rooms live in the in-memory
          demo store. The drop-in rules and role roll are the real ones.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      <div className="mt-8 space-y-4">
        {entries === null && <p className="text-white/50">Scanning for open games…</p>}
        {visible.map(({ room, partySize }) => (
          <article key={room.code} className="rounded-xl border border-white/10 bg-white/5 p-5">
            <header className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">{room.title}</h2>
              <span className="text-xs text-white/50">
                {partySize}/{room.dropInPolicy.maxPlayers} players · scene {room.sceneIndex} · {room.currentPhase}
              </span>
            </header>
            <p className="mt-1 text-sm text-white/70">{room.sceneSummary}</p>
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="rounded-full bg-white/10 px-2 py-0.5">Ally drop-in open</span>
              {room.dropInPolicy.bossAllowed && (
                <span className="rounded-full bg-red-900/60 px-2 py-0.5 text-red-200">
                  Boss drop-in possible
                </span>
              )}
              <button
                onClick={() => void dropIn(room.code)}
                disabled={busyCode !== null}
                className="ml-auto rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
              >
                {busyCode === room.code ? "The GM is staging your entrance…" : "Drop in"}
              </button>
            </div>
          </article>
        ))}
        {entries !== null && visible.length === 0 && (
          <p className="text-white/50">
            No rooms match your drop-in settings right now.{" "}
            <Link href="/settings" className="underline">Adjust settings</Link>
          </p>
        )}
      </div>

      {blocked.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold tracking-wide text-white/50">
            NOT AVAILABLE TO YOU — AND WHY
          </h2>
          <ul className="mt-3 space-y-2">
            {blocked.map(({ room, check }) => (
              <li
                key={room.code}
                className="flex items-baseline justify-between rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-sm text-white/50"
              >
                <span>{room.title}</span>
                <span className="text-xs">{check.ok === false ? check.reason : ""}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-white/40">
            Drop-in is bilateral: the room&apos;s policy and your personal settings must both
            allow it (<Link href="/settings" className="underline">your settings</Link>).
          </p>
        </section>
      )}
    </main>
  );
}
