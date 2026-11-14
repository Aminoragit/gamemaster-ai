/**
 * Turn engine — pure logic for the core game loop (BUILD_SPEC.md §4, §7.4).
 *
 * Everything here is deterministic-friendly (RNG injectable) and unit
 * tested: stat selection for an action, DC by scene phase, HP/XP
 * consequences of a dice outcome, turn rotation, boss-encounter math,
 * and the local narrative templates used when Firebase AI Logic is not
 * configured (dev stub mode) so the full loop still plays end-to-end
 * without keys. Live mode replaces the templates with real AI text —
 * the state transitions are identical either way.
 */

import { rollCheck, rollTotal, outcomeLabel, type Rng } from "./dice";
import type {
  BossSheet,
  CharacterSheet,
  DiceResult,
  Encounter,
  Room,
  ScenePhase,
} from "./types";

/* ------------------------------------------------------------------ */
/* Stat / DC selection                                                 */
/* ------------------------------------------------------------------ */

export type StatKey = keyof CharacterSheet["stats"];

export interface StatPick {
  key: StatKey;
  label: string;
  modifier: number;
}

const STAT_KEYWORDS: { key: StatKey; label: string; words: string[] }[] = [
  { key: "dex", label: "Dexterity", words: ["sneak", "hide", "stealth", "climb", "dodge", "run", "swim", "pick the lock", "lockpick"] },
  { key: "cha", label: "Charisma", words: ["bribe", "talk", "persuade", "negotiate", "charm", "lie", "ask", "greet", "taunt"] },
  { key: "int", label: "Intelligence", words: ["study", "decipher", "read", "investigate", "recall", "translate", "inspect", "search"] },
  { key: "str", label: "Strength", words: ["charge", "attack", "strike", "push", "lift", "break", "force", "hit", "fight"] },
];

export function statModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Pick the ability that best matches a free-form action's wording. */
export function pickStat(character: CharacterSheet, action: string): StatPick {
  const text = action.toLowerCase();
  const found = STAT_KEYWORDS.find((s) => s.words.some((w) => text.includes(w)));
  const key = found?.key ?? "dex";
  const label = found?.label ?? "Dexterity";
  return { key, label, modifier: statModifier(character.stats[key]) };
}

/** Difficulty class by scene phase (GM prompt contract, §4.3). */
export function dcForPhase(phase: ScenePhase): number {
  switch (phase) {
    case "bossEncounter":
      return 14;
    case "combat":
      return 13;
    default:
      return 12;
  }
}

export function suggestedActions(phase: ScenePhase): string[] {
  switch (phase) {
    case "bossEncounter":
      return ["Strike the boss", "Dodge and reposition", "Study the boss's weakness"];
    case "combat":
      return ["Charge the enemy", "Hide and strike", "Negotiate a truce"];
    default:
      return ["Search the area", "Talk to the nearest NPC", "Push onward"];
  }
}

export function rollForAction(
  character: CharacterSheet,
  action: string,
  phase: ScenePhase,
  rng?: Rng,
): { stat: StatPick; dice: DiceResult } {
  const stat = pickStat(character, action);
  const dice = rollCheck(stat.modifier, dcForPhase(phase), rng);
  return { stat, dice };
}

export function diceLogText(characterName: string, statLabel: string, dice: DiceResult): string {
  const mod = dice.modifier >= 0 ? `+ ${dice.modifier}` : `− ${Math.abs(dice.modifier)}`;
  return `🎲 ${characterName} rolls ${statLabel} — ${dice.rolls[0]} ${mod} = ${dice.total} vs DC ${dice.dc} · ${outcomeLabel(dice.outcome)}`;
}

/* ------------------------------------------------------------------ */
/* Consequences: HP / XP / levels                                      */
/* ------------------------------------------------------------------ */

export interface TurnConsequences {
  hpDelta: number;
  xpGain: number;
  levelledUp: boolean;
}

const CONSEQUENCES: Record<DiceResult["outcome"], { hpDelta: number; xpGain: number }> = {
  critical_success: { hpDelta: 0, xpGain: 30 },
  success: { hpDelta: 0, xpGain: 20 },
  failure: { hpDelta: -3, xpGain: 10 },
  critical_failure: { hpDelta: -6, xpGain: 5 },
};

export function consequencesFor(outcome: DiceResult["outcome"]): { hpDelta: number; xpGain: number } {
  return CONSEQUENCES[outcome];
}

/** Apply a resolved turn to the shared character sheet (§5). Pure. */
export function applyTurnToCharacter(
  character: CharacterSheet,
  dice: DiceResult,
  now: number,
  milestone: string,
): { character: CharacterSheet; consequences: TurnConsequences } {
  const base = consequencesFor(dice.outcome);
  let xp = character.xp + base.xpGain;
  let level = character.level;
  let maxHp = character.maxHp;
  let levelledUp = false;
  while (xp >= level * 100) {
    xp -= level * 100;
    level += 1;
    maxHp += 4;
    levelledUp = true;
  }
  const hp = levelledUp ? maxHp : Math.max(0, Math.min(character.maxHp, character.hp + base.hpDelta));
  return {
    character: {
      ...character,
      xp,
      level,
      maxHp,
      hp,
      campaignLog: [...character.campaignLog, { at: now, text: milestone }],
      updatedAt: now,
    },
    consequences: { ...base, levelledUp },
  };
}

/* ------------------------------------------------------------------ */
/* Turn rotation (§4.5)                                                */
/* ------------------------------------------------------------------ */

/** Next uid in the turn order, wrapping. Falls back to the first entry. */
export function nextTurnUid(order: string[], current: string | null): string | null {
  if (order.length === 0) return null;
  const i = current ? order.indexOf(current) : -1;
  return order[(i + 1) % order.length];
}

/** A success (or better) closes the beat and advances the scene index. */
export function advancesScene(dice: DiceResult): boolean {
  return dice.outcome === "success" || dice.outcome === "critical_success";
}

/* ------------------------------------------------------------------ */
/* Boss encounter math (§7.4)                                          */
/* ------------------------------------------------------------------ */

const BOSS_NAMES: [string, string][] = [
  ["The Gate Serpent", "Terror of the Sunken Gate"],
  ["The Sunken Warden", "Keeper of Drowned Bells"],
  ["Ashmantle the Revenant", "The Fire That Remembers"],
];

export function createBossSheet(roomCode: string, controlledByUid: string | null): BossSheet {
  const idx = [...roomCode].reduce((a, c) => a + c.charCodeAt(0), 0) % BOSS_NAMES.length;
  const [name, title] = BOSS_NAMES[idx];
  return {
    name,
    title,
    hp: 80,
    maxHp: 80,
    controlledByUid,
    abilities: [
      { id: "a1", name: "Tail Sweep", description: "Hits every adjacent hero.", cooldownTurns: 2, cooldownLeft: 0 },
      { id: "a2", name: "Drowning Roar", description: "Frightens the party; heavy damage to one hero.", cooldownTurns: 3, cooldownLeft: 0 },
      { id: "a3", name: "Crushing Coil", description: "Crushes a single hero.", cooldownTurns: 2, cooldownLeft: 0 },
    ],
    signatureMove: { id: "sig", name: "Swallow the Gate", description: "Devastating bite, unlocked at 100 menace.", cooldownTurns: 0, cooldownLeft: 0 },
    menace: 0,
  };
}

export function createBossEncounter(
  id: string,
  room: Room,
  bossControllerUid: string | null,
  turnOrder: string[],
  now: number,
): Encounter {
  return {
    id,
    kind: "boss",
    status: "active",
    boss: createBossSheet(room.code, bossControllerUid),
    turnOrder,
    turnIndex: 0,
    turnsLeft: 10,
    startedAt: now,
    endedAt: null,
  };
}

export interface BossHitResult {
  encounter: Encounter;
  damage: number;
  defeated: boolean;
}

/** A party action that succeeds damages the boss and feeds its menace. */
export function partyHitsBoss(encounter: Encounter, rng?: Rng): BossHitResult {
  const { total } = rollTotal(1, 8, 2, rng);
  const hp = Math.max(0, encounter.boss.hp - total);
  const defeated = hp <= 0;
  return {
    damage: total,
    defeated,
    encounter: {
      ...encounter,
      status: defeated ? "lost" : encounter.status,
      endedAt: defeated ? Date.now() : encounter.endedAt,
      boss: {
        ...encounter.boss,
        hp,
        menace: Math.min(100, encounter.boss.menace + 12),
      },
    },
  };
}

export interface BossActionResult {
  encounter: Encounter;
  abilityName: string;
  damage: number;
  /** True when the signature move was spent (menace resets). */
  signatureUsed: boolean;
}

/**
 * Resolve one boss ability against a target hero. Pure state transition:
 * cooldowns tick, the used ability goes on cooldown, the encounter timer
 * burns one turn. HP application to the target sheet is the caller's job
 * (it owns the character documents).
 */
export function resolveBossAbility(
  encounter: Encounter,
  abilityId: string,
  rng?: Rng,
): BossActionResult {
  const boss = encounter.boss;
  const isSignature = abilityId === boss.signatureMove.id;
  const ability = isSignature
    ? boss.signatureMove
    : boss.abilities.find((a) => a.id === abilityId);
  if (!ability) throw new Error(`Unknown boss ability: ${abilityId}`);
  if (!isSignature && ability.cooldownLeft > 0) throw new Error(`${ability.name} is on cooldown`);
  if (isSignature && boss.menace < 100) throw new Error("Signature move is locked until menace reaches 100");

  const damage = isSignature
    ? rollTotal(2, 8, 4, rng).total
    : rollTotal(1, 8, 2, rng).total;

  const abilities = boss.abilities.map((a) => ({
    ...a,
    cooldownLeft:
      a.id === abilityId ? a.cooldownTurns : Math.max(0, a.cooldownLeft - 1),
  }));

  return {
    abilityName: ability.name,
    damage,
    signatureUsed: isSignature,
    encounter: {
      ...encounter,
      turnsLeft: Math.max(0, encounter.turnsLeft - 1),
      boss: {
        ...boss,
        abilities,
        menace: isSignature ? 40 : boss.menace,
      },
    },
  };
}

/** Encounter outcome check after HP changes on either side. */
export function checkEncounterEnd(
  encounter: Encounter,
  partyHp: number[],
  now: number,
): Encounter {
  if (encounter.status !== "active") return encounter;
  if (encounter.boss.hp <= 0) return { ...encounter, status: "lost", endedAt: now };
  if (partyHp.length > 0 && partyHp.every((hp) => hp <= 0))
    return { ...encounter, status: "won", endedAt: now };
  if (encounter.turnsLeft <= 0) return { ...encounter, status: "draw", endedAt: now };
  return encounter;
}

/* ------------------------------------------------------------------ */
/* Local narrative templates (dev stub mode only)                      */
/*                                                                     */
/* Used when lib/ai.ts reports a stub result (no Firebase configured), */
/* so the loop remains fully playable locally. They are clearly        */
/* prefixed and never appear when live AI is configured.               */
/* ------------------------------------------------------------------ */

const OUTCOME_BEATS: Record<DiceResult["outcome"], string> = {
  critical_success:
    "It works better than anyone dared hope — the scene turns decisively in your favour, and the way forward opens wide.",
  success:
    "It works. The moment lands cleanly, and the story pushes forward into new danger.",
  failure:
    "It goes wrong at the worst moment. The setback costs you, and the danger closes in.",
  critical_failure:
    "Disaster. The attempt collapses spectacularly, and whatever was watching has now noticed you.",
};

export function localOpeningScene(title: string, genre: string, heroName: string): string {
  return (
    `[dev stub] The ${genre.toLowerCase()} tale of “${title}” begins. ` +
    `${heroName} stands at the threshold of the adventure as rain begins to fall and something vast stirs in the dark ahead. ` +
    `What do you do?`
  );
}

export function localAdjudication(action: string, dice: DiceResult, heroName: string): string {
  return `[dev stub] ${heroName} attempts to ${action.charAt(0).toLowerCase()}${action.slice(1)}. ${OUTCOME_BEATS[dice.outcome]}`;
}

export function localEntrance(form: "ally" | "boss", entrantName: string, bossName?: string): string {
  return form === "ally"
    ? `[dev stub] Boots splash through the flooded yard — ${entrantName} arrives at a run, drawn by the noise of the struggle, and takes a place at the party's side as if they had always belonged there.`
    : `[dev stub] The water bulges. Two amber eyes open beneath the surface — ${bossName ?? "the boss"} was never asleep, and now it rises to face the party in earnest.`;
}

export function localBridge(heroName: string, lastEvents: string[]): string {
  const last = lastEvents.length ? ` Moments ago: ${lastEvents[lastEvents.length - 1]}` : "";
  return `[dev stub] Meanwhile… ${heroName} slips away from the party's road and makes camp beneath a split oak.${last} The road will still be there at dawn — and so will the adventure.`;
}

export function localSummary(previous: string, events: string[]): string {
  const latest = events.filter(Boolean).slice(-2).join(" ");
  const merged = `${previous} ${latest}`.replace(/\[dev stub\]\s*/g, "").trim();
  return merged.length > 220 ? `${merged.slice(0, 217)}…` : merged;
}
