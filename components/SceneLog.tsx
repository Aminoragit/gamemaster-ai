import RouteBadge from "./RouteBadge";
import type { LogEntry } from "@/lib/types";

/** Shared scene-log rendering for /solo and /room?code=… (BUILD_SPEC.md §3–§4). */
export default function SceneLog({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-white/40">The story has not begun yet.</p>;
  }
  return (
    <>
      {entries.map((entry) => (
        <article key={entry.id} className="space-y-1">
          {entry.type === "dice" ? (
            <p className="inline-block rounded-lg bg-white/10 px-3 py-1.5 font-mono text-sm">{entry.text}</p>
          ) : entry.type === "system" ? (
            <p className="text-sm italic text-white/40">{entry.text}</p>
          ) : entry.type === "entrance" ? (
            <p className="font-medium text-amber-200">{entry.text}</p>
          ) : entry.type === "action" ? (
            <p className="text-white/90">{entry.text}</p>
          ) : entry.type === "npc" ? (
            <p className="text-white/80">{entry.text}</p>
          ) : (
            <p>{entry.text}</p>
          )}
          <RouteBadge route={entry.route} />
        </article>
      ))}
    </>
  );
}
