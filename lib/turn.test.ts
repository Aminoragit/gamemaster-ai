import { describe, expect, it } from "vitest";
import {
  applyTurnToCharacter,
  checkEncounterEnd,
  createBossEncounter,
  dcForPhase,
  diceLogText,
  localSummary,
  nextTurnUid,
  partyHitsBoss,
  pickStat,
  resolveBossAbility,
  rollForAction,
} from "./turn";
import type { CharacterSheet, Room } from "./types";

/** RNG that always returns a fixed face value, whatever the die size. */
const fixed = (face: number) => () => face;

const hero = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  id: "c1",
  ownerUid: "u1",
  name: "Kael",
  className: "Ranger",
  level: 1,
  xp: 0,
  hp: 20,
  maxHp: 20,
  stats: { str: 14, dex: 16, int: 12, cha: 13 },
  inventory: [],
  campaignLog: [],
  updatedAt: 0,
  ...over,
});

const room = (over: Partial<Room> = {}): Room => ({
  code: "ABC123",
  hostUid: "u1",
  title: "T",
  genre: "Fantasy",
  tone: "Heroic",
  mode: "party",
  visibility: "public",
  status: "playing",
  dropInPolicy: {
    mode: "anyone", bossAllowed: true, maxPlayers: 4,
    windows: { exploration: true, combat: true, bossEncounter: true },
    pauseDuringResolution: true,
  },
  sceneSummary: "",
  sceneIndex: 1,
  currentPhase: "bossEncounter",
  currentTurnUid: null,
  resolutionInFlight: false,
  activeEncounterId: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe("pickStat", () => {
  it("matches a bribe to Charisma and sneaking to Dexterity", () => {
    expect(pickStat(hero(), "Bribe the gatekeeper").key).toBe("cha");
    expect(pickStat(hero(), "Hide behind the crates").key).toBe("dex");
    expect(pickStat(hero(), "Charge the gate").key).toBe("str");
    expect(pickStat(hero(), "Decipher the inscription").key).toBe("int");
  });
  it("derives the modifier from the ability score", () => {
    expect(pickStat(hero(), "Hide").modifier).toBe(3); // DEX 16
    expect(pickStat(hero(), "Bribe").modifier).toBe(1); // CHA 13
  });
});

describe("dcForPhase / rollForAction", () => {
  it("scales DC by phase", () => {
    expect(dcForPhase("exploration")).toBe(12);
    expect(dcForPhase("combat")).toBe(13);
    expect(dcForPhase("bossEncounter")).toBe(14);
  });
  it("rolls with the picked stat against the phase DC", () => {
    const { stat, dice } = rollForAction(hero(), "Hide", "exploration", fixed(9));
    expect(stat.key).toBe("dex");
    expect(dice.total).toBe(12);
    expect(dice.outcome).toBe("success");
  });
});

describe("applyTurnToCharacter", () => {
  it("failure costs HP and still grants some XP", () => {
    const dice = rollForAction(hero(), "Hide", "exploration", fixed(2)).dice; // 2+3=5 < 12
    const { character, consequences } = applyTurnToCharacter(hero(), dice, 100, "m");
    expect(consequences.hpDelta).toBe(-3);
    expect(character.hp).toBe(17);
    expect(character.xp).toBe(10);
    expect(character.campaignLog).toHaveLength(1);
  });
  it("levels up at the threshold, growing max HP and healing", () => {
    const dice = rollForAction(hero(), "Hide", "exploration", fixed(20)).dice; // crit
    const start = hero({ xp: 90 });
    const { character, consequences } = applyTurnToCharacter(start, dice, 100, "m");
    expect(consequences.levelledUp).toBe(true);
    expect(character.level).toBe(2);
    expect(character.maxHp).toBe(24);
    expect(character.hp).toBe(24);
    expect(character.xp).toBe(20); // 90 + 30 − 100 threshold
  });
  it("never drops HP below zero", () => {
    const dice = rollForAction(hero(), "Hide", "exploration", fixed(1)).dice; // crit fail −6
    const { character } = applyTurnToCharacter(hero({ hp: 4 }), dice, 100, "m");
    expect(character.hp).toBe(0);
  });
});

describe("nextTurnUid", () => {
  it("advances and wraps", () => {
    expect(nextTurnUid(["a", "b", "c"], "a")).toBe("b");
    expect(nextTurnUid(["a", "b", "c"], "c")).toBe("a");
    expect(nextTurnUid(["a"], null)).toBe("a");
    expect(nextTurnUid([], "a")).toBeNull();
  });
});

describe("boss encounter math", () => {
  it("partyHitsBoss damages the boss and raises menace", () => {
    const enc = createBossEncounter("e1", room(), "u-boss", ["u1", "u-boss"], 0);
    const hit = partyHitsBoss(enc, fixed(4)); // 1d8→4 + 2 = 6
    expect(hit.damage).toBe(6);
    expect(hit.encounter.boss.hp).toBe(74);
    expect(hit.encounter.boss.menace).toBe(12);
    expect(hit.defeated).toBe(false);
  });
  it("resolveBossAbility ticks cooldowns and burns a turn", () => {
    const enc = createBossEncounter("e1", room(), "u-boss", ["u1", "u-boss"], 0);
    const res = resolveBossAbility(enc, "a2", fixed(5)); // 5 + 2 = 7
    expect(res.damage).toBe(7);
    expect(res.encounter.turnsLeft).toBe(9);
    expect(res.encounter.boss.abilities.find((a) => a.id === "a2")?.cooldownLeft).toBe(3);
    expect(() => resolveBossAbility(res.encounter, "a2", fixed(5))).toThrow(/cooldown/);
  });
  it("signature move is locked until menace is full, then resets menace", () => {
    const enc = createBossEncounter("e1", room(), "u-boss", ["u1", "u-boss"], 0);
    expect(() => resolveBossAbility(enc, "sig", fixed(5))).toThrow(/locked/);
    const charged = { ...enc, boss: { ...enc.boss, menace: 100 } };
    const res = resolveBossAbility(charged, "sig", fixed(5)); // 2d8→5,5 + 4 = 14
    expect(res.damage).toBe(14);
    expect(res.encounter.boss.menace).toBe(40);
  });
  it("checkEncounterEnd resolves wipe, boss death and timer draw", () => {
    const enc = createBossEncounter("e1", room(), "u-boss", ["u1", "u-boss"], 0);
    expect(checkEncounterEnd(enc, [0, 0], 5).status).toBe("won");
    const deadBoss = { ...enc, boss: { ...enc.boss, hp: 0 } };
    expect(checkEncounterEnd(deadBoss, [10], 5).status).toBe("lost");
    const stalled = { ...enc, turnsLeft: 0 };
    expect(checkEncounterEnd(stalled, [10], 5).status).toBe("draw");
    expect(checkEncounterEnd(enc, [10], 5).status).toBe("active");
  });
});

describe("text helpers", () => {
  it("formats a dice log line", () => {
    const { dice } = rollForAction(hero(), "Hide", "exploration", fixed(14));
    expect(diceLogText("Kael", "Dexterity", dice)).toContain("14 + 3 = 17 vs DC 12");
  });
  it("localSummary merges and truncates", () => {
    const s = localSummary("Start.", ["A thing happened.", "Another thing."]);
    expect(s).toContain("Start.");
    expect(s.length).toBeLessThanOrEqual(220);
  });
});
