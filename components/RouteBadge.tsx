import type { Route } from "@/lib/types";

/**
 * Badges every AI-generated block with the inference route that actually
 * produced it — the visible proof of the hybrid architecture.
 */
export default function RouteBadge({ route }: { route: Route | null }) {
  if (!route) return null;
  return route === "on_device" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-900/60 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
      ⚡ On-device · Gemini Nano
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-900/60 px-2 py-0.5 text-[11px] font-medium text-sky-300">
      ☁ Cloud · Gemini
    </span>
  );
}
