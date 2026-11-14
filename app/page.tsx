"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createRoom, ensureUser } from "@/lib/game";
import { getDropInSettings, getIdentity, setDisplayName } from "@/lib/session";

/**
 * Home — entry point (BUILD_SPEC.md §3).
 * Create a room (service layer issues the code and the GM opening
 * scene), join with a code, continue solo, or browse the lobby.
 */
export default function HomePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setName(getIdentity().displayName);
    })();
  }, []);

  async function create() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const displayName = name.trim() || "Adventurer";
      setDisplayName(displayName);
      const id = getIdentity();
      await ensureUser(id.uid, displayName, getDropInSettings());
      const snap = await createRoom({
        hostUid: id.uid,
        hostName: displayName,
        title: "The Sunken Gate",
        genre: "Fantasy",
        tone: "Heroic",
        visibility: "public",
      });
      router.push(`/room?code=${snap.room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the room");
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-6 py-16">
      <h1 className="text-center text-5xl font-bold tracking-tight">
        GameMaster <span className="text-amber-400">AI</span>
      </h1>
      <p className="mt-4 max-w-xl text-center text-white/70">
        A tabletop RPG run by an AI game master — narrated in the cloud,
        reacted to on-device. No human GM, no scheduling: drop into a live
        game, or keep your campaign going solo.
      </p>
      <p className="mt-2 text-center text-xs text-white/40">
        ⚡ On-device (Gemini Nano) + ☁ Cloud (Gemini) via Firebase AI Logic
      </p>

      <label className="mt-10 flex w-full items-center gap-3 text-sm text-white/60">
        Display name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim()) setDisplayName(name.trim());
          }}
          placeholder="How the table knows you"
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white"
        />
      </label>

      <div className="mt-4 grid w-full gap-4 sm:grid-cols-2">
        <button
          onClick={() => void create()}
          disabled={creating}
          className="rounded-xl bg-amber-500 px-6 py-4 text-center font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
        >
          {creating ? "The GM is setting the scene…" : "Create a room"}
        </button>
        <Link
          href="/solo"
          className="rounded-xl bg-white/10 px-6 py-4 text-center font-semibold hover:bg-white/20"
        >
          Continue solo campaign
        </Link>
      </div>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      <form
        className="mt-4 flex w-full gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) router.push(`/room?code=${code.trim().toUpperCase()}`);
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Room code (e.g. K7QX2A)"
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 uppercase placeholder:normal-case"
        />
        <button className="rounded-xl bg-white/10 px-6 font-semibold hover:bg-white/20">
          Join
        </button>
      </form>

      <nav className="mt-10 flex gap-6 text-sm text-white/70">
        <Link href="/lobby" className="hover:text-white">🌐 Public lobby</Link>
        <Link href="/friends" className="hover:text-white">👥 Friends</Link>
        <Link href="/settings" className="hover:text-white">⚙ Settings</Link>
      </nav>
    </main>
  );
}
