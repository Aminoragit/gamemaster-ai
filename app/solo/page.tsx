"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SceneLog from "@/components/SceneLog";
import {
  ensureUser,
  getOrCreateSoloRoom,
  subscribeRoom,
  takeTurn,
  type RoomSnapshot,
} from "@/lib/game";
import { getIdentity, getDropInSettings, type LocalIdentity } from "@/lib/session";
import { suggestedActions } from "@/lib/turn";

/**
 * Solo campaign (BUILD_SPEC.md §4–§5) — the full game loop on the same
 * character sheet as multiplayer: GM opening scene → action → dice →
 * cloud adjudication → updated sheet → next scene. Kicked/left players
 * land here too; their solo thread already holds a "meanwhile…" bridge
 * scene written by the kick path (lib/game.ts §10).
 */
export default function SoloPage() {
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const id = getIdentity();
    setIdentity(id);
    let unsub = () => {};
    void (async () => {
      const noticeText = window.sessionStorage.getItem("gm-solo-notice");
      if (noticeText) {
        setNotice(noticeText);
        window.sessionStorage.removeItem("gm-solo-notice");
      }
      try {
        await ensureUser(id.uid, id.displayName, getDropInSettings());
        const solo = await getOrCreateSoloRoom(id.uid, id.displayName);
        setSnap(solo);
        unsub = subscribeRoom(solo.room.code, (s) => { if (s) setSnap(s); });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start your solo campaign");
      }
    })();
    return () => unsub();
  }, []);

  const member = snap?.members.find((m) => m.uid === identity?.uid);
  const character = member ? snap?.characters[member.characterId] : undefined;

  async function act(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !snap || !identity || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await takeTurn(snap.room.code, identity.uid, trimmed);
      setSnap(result.snapshot);
      setAction("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The GM stumbled — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Solo campaign</h1>
        {character && (
          <span className="text-sm text-white/50">
            {character.name} the {character.className} · Lv {character.level} · HP {character.hp}/{character.maxHp} · XP {character.xp}
          </span>
        )}
      </header>

      {notice && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          {notice} Your character, HP and progress came with you — nothing was lost.
        </p>
      )}

      <section className="flex-1 space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
        {snap ? (
          <SceneLog entries={snap.log} />
        ) : (
          <p className="text-sm text-white/40">{error ?? "The GM is setting the scene…"}</p>
        )}
      </section>

      {snap && (
        <div className="flex flex-wrap gap-2 text-xs">
          {suggestedActions(snap.room.currentPhase).map((s) => (
            <button
              key={s}
              onClick={() => setAction(s)}
              className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act(action);
        }}
      >
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="What do you do?"
          disabled={busy || !snap}
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 disabled:opacity-50"
        />
        <button
          disabled={busy || !snap}
          className="rounded-xl bg-amber-500 px-6 font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
        >
          {busy ? "Rolling…" : "Act"}
        </button>
      </form>

      {error && snap && <p className="text-sm text-red-300">{error}</p>}
      {snap && (
        <p className="text-xs text-white/40">
          Scene {snap.room.sceneIndex} · {snap.room.sceneSummary} Your character sheet is shared
          with multiplayer — everything earned here carries over, and vice versa. Feeling social?{" "}
          <Link href="/lobby" className="underline">Drop into a live game</Link>.
        </p>
      )}
    </main>
  );
}
