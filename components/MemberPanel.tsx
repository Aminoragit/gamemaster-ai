"use client";

import type { RoomMember } from "@/lib/types";

/**
 * Party panel (BUILD_SPEC.md §3, §9, §10).
 * Skeleton: renders members with the social/moderation actions wired to
 * callbacks — friend-add for non-friends, host kick and vote-kick for the
 * host/members. Firestore writes land in the implementation phase.
 */
export interface MemberPanelProps {
  members: RoomMember[];
  currentUid: string;
  isHost: boolean;
  friendUids: Set<string>;
  onAddFriend: (uid: string) => void;
  onKick: (uid: string) => void;
  onStartVoteKick: (uid: string) => void;
}

export default function MemberPanel({
  members,
  currentUid,
  isHost,
  friendUids,
  onAddFriend,
  onKick,
  onStartVoteKick,
}: MemberPanelProps) {
  return (
    <aside className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-white/80">Party</h2>
      <ul className="space-y-2">
        {members.map((m) => (
          <li key={m.uid} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {m.displayName}
              {m.role === "host" && <span className="ml-1 text-amber-400">★ host</span>}
              {m.role === "boss" && <span className="ml-1 text-red-400">👹 boss</span>}
              {m.uid === currentUid && <span className="ml-1 text-white/40">(you)</span>}
            </span>
            {m.uid !== currentUid && m.status === "active" && (
              <span className="flex gap-1">
                {!friendUids.has(m.uid) && (
                  <button
                    onClick={() => onAddFriend(m.uid)}
                    className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                  >
                    + Friend
                  </button>
                )}
                {isHost ? (
                  <button
                    onClick={() => onKick(m.uid)}
                    className="rounded bg-red-900/50 px-2 py-1 text-xs text-red-200 hover:bg-red-900"
                  >
                    Kick
                  </button>
                ) : (
                  <button
                    onClick={() => onStartVoteKick(m.uid)}
                    className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                  >
                    Vote kick
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
