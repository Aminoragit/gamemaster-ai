"use client";

import Link from "next/link";

/**
 * Friends (BUILD_SPEC.md §9) — friend list, pending requests, friends'
 * open rooms and the invite inbox. Scaffold with demo entries; the
 * Firestore collections are friendRequests / friendships / invites.
 */
export default function FriendsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <h1 className="text-3xl font-bold">Friends</h1>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-white/60">FRIEND REQUESTS</h2>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <p>
            <strong>Rin</strong> wants to adventure with you.
            <span className="ml-3 inline-flex gap-2">
              <button className="rounded bg-amber-500 px-3 py-1 font-semibold text-black">Accept</button>
              <button className="rounded bg-white/10 px-3 py-1">Decline</button>
            </span>
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-white/60">YOUR FRIENDS</h2>
        <ul className="space-y-2">
          <li className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
            <span>Mira · <span className="text-emerald-300">looking for a game</span></span>
            <Link href="/lobby" className="rounded bg-white/10 px-3 py-1 hover:bg-white/20">
              See their room
            </Link>
          </li>
          <li className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
            <span>Jae · in a boss encounter</span>
            <button className="rounded bg-white/10 px-3 py-1 hover:bg-white/20">Invite to my room</button>
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-white/60">INVITES</h2>
        <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
          No pending invites. Invites you receive appear here and respect your{" "}
          <Link href="/settings" className="underline">drop-in settings</Link>.
        </p>
      </section>
    </main>
  );
}
