/**
 * Drop-in engine — pure functions, unit-tested.
 *
 * Two responsibilities (BUILD_SPEC.md §6–§7):
 *  1. `canDropIn` — the bilateral eligibility rule: room policy AND the
 *     player's personal settings must both allow the drop-in.
 *  2. `rollDropInRole` — situation-weighted decision between the two
 *     drop-in forms: party ALLY or active BOSS. Hard gates run first;
 *     if any boss gate fails, the result is ally with no roll.
 */

import type {
  DropInForm,
  DropInSettings,
  Room,
} from "./types";

export interface DropInContext {
  room: Room;
  userSettings: DropInSettings;
  /** Is the user friends with at least one current room member? */
  isFriendOfMember: boolean;
  /** Does an unexpired invite exist for this user + room? */
  hasInvite: boolean;
  /** Current active party members (boss player excluded). */
  partySize: number;
}

/** Bilateral eligibility — §6.3. Returns the reason when not eligible. */
export function canDropIn(
  ctx: DropInContext,
): { ok: true } | { ok: false; reason: string } {
  const { room, userSettings } = ctx;
  const policy = room.dropInPolicy;

  if (!userSettings.enabled) return { ok: false, reason: "drop-in disabled in personal settings" };
  if (room.mode !== "party") return { ok: false, reason: "solo rooms never accept drop-ins" };
  if (room.visibility !== "public" && !ctx.hasInvite)
    return { ok: false, reason: "room is not public" };
  if (room.status !== "playing") return { ok: false, reason: "room is not in play" };
  if (policy.mode === "off") return { ok: false, reason: "room drop-in policy is off" };
  if (policy.mode === "friends" && !ctx.isFriendOfMember)
    return { ok: false, reason: "room accepts friends only" };
  if (policy.mode === "invite" && !ctx.hasInvite)
    return { ok: false, reason: "room accepts invites only" };
  if (userSettings.scope === "friendsOnly" && !ctx.isFriendOfMember && !ctx.hasInvite)
    return { ok: false, reason: "personal scope is friends only" };
  if (ctx.partySize >= policy.maxPlayers)
    return { ok: false, reason: "party is full" };
  if (!policy.windows[room.currentPhase])
    return { ok: false, reason: `drop-in closed during ${room.currentPhase}` };
  if (policy.pauseDuringResolution && room.resolutionInFlight)
    return { ok: false, reason: "a resolution is in flight" };
  return { ok: true };
}

export interface RoleRollInput {
  room: Room;
  userSettings: DropInSettings;
  partySize: number;
  /** Scene number within the session (1-based). */
  sceneIndex: number;
  /** Average party HP as a fraction 0–1. */
  partyHpFraction: number;
  /** Has a boss drop-in already happened in this room session? */
  bossDropAlreadyUsed: boolean;
  /** Is a player-controlled boss currently active? */
  bossCurrentlyActive: boolean;
}

export interface RoleRollResult {
  form: DropInForm;
  /** Final weights actually used (after gates/clamps); boss = 0 when gated. */
  weights: { ally: number; boss: number };
  /** Human-readable factors, surfaced in the demo/log for transparency. */
  factors: string[];
  /** True when the boss form was ruled out by a hard gate (no roll made). */
  gated: boolean;
}

/**
 * Situation-weighted role roll — §7. Base 70/30, adjusted by the table in
 * the spec, clamped so neither outcome is impossible once gates pass.
 * `rng` returns [0, 1); injectable for tests.
 */
export function rollDropInRole(
  input: RoleRollInput,
  rng: () => number = Math.random,
): RoleRollResult {
  const { room, userSettings } = input;
  const factors: string[] = [];

  // Hard gates (§7.1): any failure → ally, no roll.
  const gates: [boolean, string][] = [
    [room.dropInPolicy.bossAllowed, "room disallows boss drop-ins"],
    [userSettings.acceptBossRole, "player has not opted into the boss role"],
    [room.currentPhase === "bossEncounter", "no boss encounter in progress"],
    [!input.bossCurrentlyActive, "a player boss is already active"],
  ];
  for (const [passed, why] of gates) {
    if (!passed) {
      return { form: "ally", weights: { ally: 100, boss: 0 }, factors: [`gate: ${why}`], gated: true };
    }
  }

  let ally = 70;
  let boss = 30;
  const adj = (a: number, b: number, label: string) => {
    ally += a;
    boss += b;
    factors.push(label);
  };

  // Boss encounter is live (guaranteed by the gates at this point).
  adj(-30, +30, "boss encounter in progress: boss +30");
  if (input.sceneIndex <= 3) adj(+25, -25, "early exploration: ally +25");
  if (input.partySize >= 3) adj(-10, +10, "party of 3+: boss +10");
  if (input.partySize <= 1) adj(+20, -20, "host alone: ally +20");
  if (input.bossDropAlreadyUsed) adj(+30, -30, "boss drop already used this session: ally +30");
  if (input.partyHpFraction < 0.4) adj(+15, -15, "party HP below 40% (mercy rule): ally +15");

  ally = Math.max(5, ally);
  boss = Math.max(5, boss);

  const roll = rng() * (ally + boss);
  return {
    form: roll < boss ? "boss" : "ally",
    weights: { ally, boss },
    factors,
    gated: false,
  };
}
