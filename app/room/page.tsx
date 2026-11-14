"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import BossControls from "@/components/BossControls";
import MemberPanel from "@/components/MemberPanel";
import RoomSettingsPanel from "@/components/RoomSettingsPanel";
import SceneLog from "@/components/SceneLog";
import {
  bossAction,
  bossTaunt,
  ensureUser,
  getRoomSnapshot,
  joinRoom,
  kickMember,
  leaveRoomToSolo,
  sendFriendRequest,
  startVoteKick,
  subscribeRoom,
  takeTurn,
  updateRoomPolicy,
  type RoomSnapshot,
} from "@/lib/game";
import { getDropInSettings, getIdentity, type LocalIdentity } from "@/lib/session";
import { suggestedActions } from "@/lib/turn";
import type { DropInPolicy } from "@/lib/types";

/**
 * Game screen (BUILD_SPEC.md §3–§4, §6–§10), wired to the service layer
 * in lib/game.ts. The scene log streams from the room subscription
 * (Firestore onSnapshot when configured, in-memory store otherwise);
 * actions run the same turn cycle as solo. The member panel's
 * friend-add / kick / vote-kick buttons call the real service functions,
 * and a player who is kicked is bridged to /solo with their character
 * intact. Boss encounters activate the boss control panel for the
 * controlling player.
 */
export default function RoomPage() {
  return (
    <Suspense fallback={<main className="px-6 py-10 text-white/60">Loading room…</main>}>
      <RoomScreen />
    </Suspense>
  );
}

function RoomScreen() {
  const router = useRouter();
  // Static export (output: 'export') has no dynamic segments: the room
  // code arrives as /room?code=XXXXXX and is read client-side. The
  // Suspense wrapper above is what allows useSearchParams during the
  // static prerender.
  const searchParams = useSearchParams();
  const code = (searchParams.get("code") ?? "").toUpperCase();
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<{ form: string; text: string } | null>(null);
  const [friendUids, setFriendUids] = useState<Set<string>>(new Set());
  const [policy, setPolicy] = useState<DropInPolicy | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || !code) return;
    startedRef.current = true;
    const id = getIdentity();
    setIdentity(id);
    let unsub = () => {};
    void (async () => {
      const rawBriefing = window.sessionStorage.getItem(`gm-briefing-${code}`);
      if (rawBriefing) {
        try {
          setBriefing(JSON.parse(rawBriefing) as { form: string; text: string });
        } catch { /* ignore malformed briefing */ }
        window.sessionStorage.removeItem(`gm-briefing-${code}`);
      }
      try {
        await ensureUser(id.uid, id.displayName, getDropInSettings());
        let snapshot = await getRoomSnapshot(code);
        if (!snapshot) {
          setNotFound(true);
          return;
        }
        let me = snapshot.members.find((m) => m.uid === id.uid);
        if (!me) {
          snapshot = await joinRoom(code, id.uid, id.displayName, "code");
          me = snapshot.members.find((m) => m.uid === id.uid);
        }
        if (me?.status === "kicked") {
          window.sessionStorage.setItem(
            "gm-solo-notice",
            "You were removed from that room by the host.",
          );
          router.push("/solo");
          return;
        }
        setSnap(snapshot);
        setPolicy(snapshot.room.dropInPolicy);
        unsub = subscribeRoom(code, (s) => { if (s) setSnap(s); });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the room");
      }
    })();
    return () => unsub();
  }, [code, router]);

  // If the host removes us while we are on this screen, the subscription
  // shows our membership as kicked — bridge to solo exactly like §10.
  useEffect(() => {
    if (!snap || !identity) return;
    const me = snap.members.find((m) => m.uid === identity.uid);
    if (me?.status === "kicked") {
      window.sessionStorage.setItem("gm-solo-notice", "You were removed from that room by the host.");
      router.push("/solo");
    }
  }, [snap, identity, router]);

  const me = snap?.members.find((m) => m.uid === identity?.uid);
  const isHost = Boolean(snap && identity && snap.room.hostUid === identity.uid);
  const encounter = snap?.encounters.find((e) => e.status === "active");
  const iAmBoss = Boolean(encounter && identity && encounter.boss.controlledByUid === identity.uid);
  const turnName = snap?.members.find((m) => m.uid === snap.room.currentTurnUid)?.displayName;

  async function guard(fn: () => Promise<RoomSnapshot | void>, failMessage: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result) setSnap(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : failMessage);
    } finally {
      setBusy(false);
    }
  }

  function act(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !snap || !identity) return;
    void guard(async () => {
      const result = await takeTurn(snap.room.code, identity.uid, trimmed);
      setAction("");
      return result.snapshot;
    }, "The GM stumbled — try again");
  }

  if (notFound) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16 text-center">
        <h1 className="text-2xl font-bold">Room {code} not found</h1>
        <p className="mt-3 text-white/60">
          Check the code, or <Link href="/" className="underline">create a new room</Link> /{" "}
          <Link href="/lobby" className="underline">browse the lobby</Link>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-4 px-6 py-8 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <header>
          <h1 className="text-2xl font-bold">
            {snap?.room.title ?? "Loading…"}{" "}
            <span className="text-sm font-normal text-white/40">room {code}</span>
          </h1>
          {snap && (
            <p className="mt-1 text-xs text-white/50">
              Scene {snap.room.sceneIndex} · {snap.room.currentPhase}
              {turnName ? ` · suggested turn: ${turnName}` : ""}
              {encounter
                ? ` · 👹 ${encounter.boss.name} HP ${encounter.boss.hp}/${encounter.boss.maxHp} · ${encounter.turnsLeft} turns left`
                : ""}
            </p>
          )}
        </header>

        {briefing && (
          <section className="rounded-xl border border-sky-500/40 bg-sky-950/40 px-4 py-3 text-sm">
            <p className="font-semibold text-sky-200">
              {briefing.form === "boss" ? "👹 You have arrived as the boss." : "⚔️ You dropped in as an ally."}{" "}
              Previously on…
            </p>
            <p className="mt-1 text-sky-100/80">{briefing.text}</p>
            <button onClick={() => setBriefing(null)} className="mt-2 text-xs underline">
              Dismiss
            </button>
          </section>
        )}
        {notice && (
          <p className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white/80">{notice}</p>
        )}

        <section className="flex-1 space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
          {snap ? <SceneLog entries={snap.log} /> : <p className="text-sm text-white/40">{error ?? "Loading the scene…"}</p>}
        </section>

        {snap && iAmBoss && encounter ? (
          <BossControls
            boss={encounter.boss}
            isMyTurn={!busy}
            onAbility={(abilityId) => {
              if (!identity) return;
              void guard(() => bossAction(snap.room.code, identity.uid, abilityId), "The boss action failed");
            }}
            onTaunt={() => {
              if (!identity) return;
              void guard(() => bossTaunt(snap.room.code, identity.uid), "The taunt failed");
            }}
          />
        ) : snap ? (
          <>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                act(action);
              }}
            >
              <input
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="What do you do?"
                disabled={busy || !me || me.status !== "active"}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 disabled:opacity-50"
              />
              <button
                disabled={busy || !me || me.status !== "active"}
                className="rounded-xl bg-amber-500 px-6 font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
              >
                {busy ? "Rolling…" : "Act"}
              </button>
            </form>
            <div className="flex gap-2 text-xs">
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
          </>
        ) : null}

        {error && snap && <p className="text-sm text-red-300">{error}</p>}
        {snap && me?.status === "active" && (
          <button
            onClick={() => {
              if (!identity) return;
              void guard(async () => {
                await leaveRoomToSolo(snap.room.code, identity.uid);
                window.sessionStorage.setItem("gm-solo-notice", "You left the party to continue solo.");
                router.push("/solo");
              }, "Could not leave the room");
            }}
            className="self-start text-xs text-white/50 underline hover:text-white"
          >
            Leave to solo (keeps your character)
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {snap && identity && (
          <MemberPanel
            members={snap.members.filter((m) => m.status === "active")}
            currentUid={identity.uid}
            isHost={isHost}
            friendUids={friendUids}
            onAddFriend={(uid) => {
              void guard(async () => {
                const result = await sendFriendRequest(identity.uid, uid);
                setFriendUids((prev) => new Set(prev).add(uid));
                setNotice(
                  "pairId" in result
                    ? "You are now friends!"
                    : "Friend request sent.",
                );
              }, "Could not send the friend request");
            }}
            onKick={(uid) => {
              void guard(async () => {
                const result = await kickMember(snap.room.code, identity.uid, uid, "other");
                setNotice("Player removed. They continue solo with their character intact.");
                return result.snapshot ?? undefined;
              }, "Could not remove that player");
            }}
            onStartVoteKick={(uid) => {
              void guard(async () => {
                const result = await startVoteKick(snap.room.code, identity.uid, uid);
                setNotice(
                  result.kicked
                    ? "Vote passed — the player was removed and continues solo."
                    : "Vote-kick started. A majority of the remaining party must agree within 60 seconds.",
                );
              }, "Could not start the vote");
            }}
          />
        )}
        {snap && policy && (
          <RoomSettingsPanel
            policy={policy}
            disabled={!isHost}
            onChange={(next) => {
              setPolicy(next);
              if (isHost && identity) {
                void updateRoomPolicy(snap.room.code, identity.uid, next).catch((e) =>
                  setError(e instanceof Error ? e.message : "Could not save room settings"),
                );
              }
            }}
          />
        )}
        {snap && (
          <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-white/50">
            {snap.room.sceneSummary}
          </p>
        )}
      </div>
    </main>
  );
}
