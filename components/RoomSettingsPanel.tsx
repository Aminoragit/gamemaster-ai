"use client";

import type { DropInPolicy } from "@/lib/types";

/**
 * Host-side room settings (BUILD_SPEC.md §6.1): drop-in policy, boss
 * drop-in allowance, party cap, and open drop-in windows.
 */
export interface RoomSettingsPanelProps {
  policy: DropInPolicy;
  disabled: boolean;
  onChange: (policy: DropInPolicy) => void;
}

export default function RoomSettingsPanel({ policy, disabled, onChange }: RoomSettingsPanelProps) {
  const set = (patch: Partial<DropInPolicy>) => onChange({ ...policy, ...patch });
  const setWindow = (key: keyof DropInPolicy["windows"], value: boolean) =>
    onChange({ ...policy, windows: { ...policy.windows, [key]: value } });

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
      <h2 className="mb-3 font-semibold text-white/80">Room settings · drop-in</h2>
      <label className="mb-2 flex items-center justify-between gap-3">
        Who can drop in
        <select
          value={policy.mode}
          disabled={disabled}
          onChange={(e) => set({ mode: e.target.value as DropInPolicy["mode"] })}
          className="rounded bg-black/40 px-2 py-1"
        >
          <option value="anyone">Anyone</option>
          <option value="friends">Friends only</option>
          <option value="invite">Invite only</option>
          <option value="off">No drop-ins</option>
        </select>
      </label>
      <label className="mb-2 flex items-center justify-between gap-3">
        Max party size
        <input
          type="number"
          min={2}
          max={4}
          value={policy.maxPlayers}
          disabled={disabled}
          onChange={(e) => set({ maxPlayers: Number(e.target.value) })}
          className="w-16 rounded bg-black/40 px-2 py-1"
        />
      </label>
      <label className="mb-2 flex items-center justify-between gap-3">
        Allow boss drop-ins
        <input
          type="checkbox"
          checked={policy.bossAllowed}
          disabled={disabled}
          onChange={(e) => set({ bossAllowed: e.target.checked })}
        />
      </label>
      <fieldset className="mt-3">
        <legend className="mb-1 text-white/60">Drop-in windows</legend>
        {(Object.keys(policy.windows) as (keyof DropInPolicy["windows"])[]).map((key) => (
          <label key={key} className="mb-1 flex items-center justify-between gap-3 capitalize">
            {key}
            <input
              type="checkbox"
              checked={policy.windows[key]}
              disabled={disabled}
              onChange={(e) => setWindow(key, e.target.checked)}
            />
          </label>
        ))}
      </fieldset>
    </section>
  );
}
