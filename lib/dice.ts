/**
 * Dice engine — pure and deterministic-friendly (RNG injectable for tests).
 * BUILD_SPEC.md §4.3: d20 + modifier vs DC, four outcome tiers.
 */

import type { DiceResult } from "./types";

export type Rng = (sides: number) => number;

export const defaultRng: Rng = (sides) =>
  1 + Math.floor(Math.random() * sides);

export function rollDie(sides: number, rng: Rng = defaultRng): number {
  if (sides < 2) throw new Error("A die needs at least 2 sides");
  return rng(sides);
}

export function rollDice(count: number, sides: number, rng: Rng = defaultRng): number[] {
  return Array.from({ length: count }, () => rollDie(sides, rng));
}

/**
 * A d20 skill check. Natural 20 / natural 1 override the total comparison,
 * per classic tabletop rules.
 */
export function rollCheck(
  modifier: number,
  dc: number,
  rng: Rng = defaultRng,
): DiceResult {
  const roll = rollDie(20, rng);
  const total = roll + modifier;
  const outcome =
    roll === 20
      ? "critical_success"
      : roll === 1
        ? "critical_failure"
        : total >= dc
          ? "success"
          : "failure";
  return {
    expr: "1d20",
    rolls: [roll],
    modifier,
    total,
    dc,
    outcome,
  };
}

/** Damage / generic roll: sum of N dice plus a flat modifier. */
export function rollTotal(
  count: number,
  sides: number,
  modifier = 0,
  rng: Rng = defaultRng,
): { rolls: number[]; total: number } {
  const rolls = rollDice(count, sides, rng);
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) + modifier };
}

export function outcomeLabel(outcome: DiceResult["outcome"]): string {
  switch (outcome) {
    case "critical_success":
      return "Critical success!";
    case "success":
      return "Success";
    case "failure":
      return "Failure";
    case "critical_failure":
      return "Critical failure!";
  }
}
