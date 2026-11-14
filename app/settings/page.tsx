"use client";

import { useEffect, useState } from "react";
import DropInSettingsForm from "@/components/DropInSettingsForm";
import { ensureUser } from "@/lib/game";
import {
  DEFAULT_DROPIN_SETTINGS,
  getDropInSettings,
  getIdentity,
  saveDropInSettings,
} from "@/lib/session";
import type { DropInSettings } from "@/lib/types";

/**
 * Personal settings (BUILD_SPEC.md §6.2) — the solo player's half of
 * the bilateral drop-in rule. Persisted locally and mirrored to
 * users/{uid}.settings.dropIn through the service layer.
 */
export default function SettingsPage() {
  const [dropIn, setDropIn] = useState<DropInSettings>(DEFAULT_DROPIN_SETTINGS);

  useEffect(() => {
    void (async () => {
      setDropIn(getDropInSettings());
    })();
  }, []);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <h1 className="mb-8 text-3xl font-bold">Settings</h1>
      <DropInSettingsForm
        settings={dropIn}
        onChange={(next) => {
          setDropIn(next);
          saveDropInSettings(next);
          const id = getIdentity();
          void ensureUser(id.uid, id.displayName, next).catch(() => undefined);
        }}
      />
      <p className="mt-4 text-xs text-white/40">
        Drop-in only happens when a room&apos;s policy and these personal settings both allow
        it. Turning drop-in off here closes every room to you, whatever the room allows.
      </p>
    </main>
  );
}
