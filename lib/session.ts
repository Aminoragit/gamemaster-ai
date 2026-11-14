/**
 * Local identity & personal settings (browser side).
 *
 * Until Firebase Auth lands (user step, BUILD_SPEC.md §14), the client
 * keeps a stable anonymous uid + display name in localStorage so solo
 * and multiplayer share one identity per browser. Personal drop-in
 * settings (§6.2) live here too and are mirrored to the user document
 * by the service layer whenever it runs.
 */

import type { DropInSettings } from "./types";

export interface LocalIdentity {
  uid: string;
  displayName: string;
}

const UID_KEY = "gm-uid";
const NAME_KEY = "gm-display-name";
const SETTINGS_KEY = "gm-dropin-settings";

export const DEFAULT_DROPIN_SETTINGS: DropInSettings = {
  enabled: true,
  scope: "any",
  showPresence: true,
  acceptBossRole: true,
};

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getIdentity(): LocalIdentity {
  if (typeof window === "undefined") return { uid: "local-anon", displayName: "Adventurer" };
  let uid = window.localStorage.getItem(UID_KEY);
  if (!uid) {
    uid = randomId("u");
    window.localStorage.setItem(UID_KEY, uid);
  }
  const displayName = window.localStorage.getItem(NAME_KEY) ?? "Adventurer";
  return { uid, displayName };
}

export function setDisplayName(name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NAME_KEY, name);
}

export function getDropInSettings(): DropInSettings {
  if (typeof window === "undefined") return DEFAULT_DROPIN_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_DROPIN_SETTINGS;
    return { ...DEFAULT_DROPIN_SETTINGS, ...(JSON.parse(raw) as Partial<DropInSettings>) };
  } catch {
    return DEFAULT_DROPIN_SETTINGS;
  }
}

export function saveDropInSettings(settings: DropInSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
