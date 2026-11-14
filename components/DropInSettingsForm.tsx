"use client";

import type { DropInSettings } from "@/lib/types";

/**
 * Personal drop-in settings (BUILD_SPEC.md §6.2) — the player side of
 * the bilateral rule. Drop-in happens only when these AND the room's
 * policy both allow it.
 */
export interface DropInSettingsFormProps {
  settings: DropInSettings;
  onChange: (settings: DropInSettings) => void;
}

export default function DropInSettingsForm({ settings, onChange }: DropInSettingsFormProps) {
  const set = (patch: Partial<DropInSettings>) => onChange({ ...settings, ...patch });
  return (
    <section className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
      <h2 className="font-semibold text-white/80">Drop-in preferences</h2>
      <label className="flex items-center justify-between gap-3">
        Enable drop-in
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
      </label>
      <label className="flex items-center justify-between gap-3">
        Rooms I can drop into        <select
          value={settings.scope}
          disabled={!settings.enabled}
          onChange={(e) => set({ scope: e.target.value as DropInSettings["scope"] })}
          className="rounded bg-black/40 px-2 py-1"
        >
          <option value="any">Any public room</option>
          <option value="friendsOnly">Friends-only rooms</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-3">
        Show my &ldquo;looking for a game&rdquo; status to friends
        <input
          type="checkbox"
          checked={settings.showPresence}
          onChange={(e) => set({ showPresence: e.target.checked })}
        />
      </label>
      <label className="flex items-center justify-between gap-3">
        I accept being dropped in as the boss
        <input
          type="checkbox"
          checked={settings.acceptBossRole}
          onChange={(e) => set({ acceptBossRole: e.target.checked })}
        />
      </label>
      <p className="text-xs text-white/50">
        A boss drop-in can only happen when the room also allows it — both switches must be on.
      </p>
    </section>
  );
}
