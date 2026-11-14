import { describe, expect, it } from "vitest";
import { canDropIn, rollDropInRole, type DropInContext, type RoleRollInput } from "./dropin";
import type { DropInSettings, Room } from "./types";

const settings = (over: Partial<DropInSettings> = {}): DropInSettings => ({
  enabled: true,
  scope: "any",
  showPresence: true,
  acceptBossRole: true,
  ...over,
});

const room = (over: Partial<Room> = {}): Room => ({
  code: "ABC123",
  hostUid: "host",
  title: "The Sunken Gate",
  genre: "fantasy",
  tone: "heroic",
  mode: "party",
  visibility: "public",
  status: "playing",
  dropInPolicy: {
    mode: "anyone",
    bossAllowed: true,
    maxPlayers: 4,
    windows: { exploration: true, combat: true, bossEncounter: true },
    pauseDuringResolution: true,
  },
  sceneSummary: "",
  sceneIndex: 5,
  currentPhase: "exploration",
  currentTurnUid: null,
  resolutionInFlight: false,
  activeEncounterId: null,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const ctx = (over: Partial<DropInContext> = {}): DropInContext => ({
  room: room(),
  userSettings: settings(),
  isFriendOfMember: false,
  hasInvite: false,
  partySize: 2,
  ...over,
});

describe("canDropIn — bilateral rule", () => {
  it("allows when both sides allow", () => {
    expect(canDropIn(ctx()).ok).toBe(true);
  });
  it("blocks when personal drop-in is disabled", () => {
    expect(canDropIn(ctx({ userSettings: settings({ enabled: false }) })).ok).toBe(false);
  });
  it("blocks when the room policy is off", () => {
    const r = room();
    r.dropInPolicy.mode = "off";
    expect(canDropIn(ctx({ room: r })).ok).toBe(false);
  });
  it("friends-only room requires a friend inside", () => {
    const r = room();
    r.dropInPolicy.mode = "friends";
    expect(canDropIn(ctx({ room: r })).ok).toBe(false);
    expect(canDropIn(ctx({ room: r, isFriendOfMember: true })).ok).toBe(true);
  });
  it("friendsOnly personal scope blocks stranger rooms", () => {
    expect(
      canDropIn(ctx({ userSettings: settings({ scope: "friendsOnly" }) })).ok,
    ).toBe(false);
  });
  it("blocks a full party and a closed phase window", () => {
    expect(canDropIn(ctx({ partySize: 4 })).ok).toBe(false);
    const r = room({ currentPhase: "combat" });
    r.dropInPolicy.windows.combat = false;
    expect(canDropIn(ctx({ room: r })).ok).toBe(false);
  });
  it("blocks while a resolution is in flight", () => {
    expect(canDropIn(ctx({ room: room({ resolutionInFlight: true }) })).ok).toBe(false);
  });
});

const rollInput = (over: Partial<RoleRollInput> = {}): RoleRollInput => ({
  room: room({ currentPhase: "bossEncounter" }),
  userSettings: settings(),
  partySize: 4,
  sceneIndex: 8,
  partyHpFraction: 0.9,
  bossDropAlreadyUsed: false,
  bossCurrentlyActive: false,
  ...over,
});

describe("rollDropInRole — gates", () => {
  it("is gated to ally when the room disallows boss drops", () => {
    const r = room({ currentPhase: "bossEncounter" });
    r.dropInPolicy.bossAllowed = false;
    const res = rollDropInRole(rollInput({ room: r }), () => 0);
    expect(res.form).toBe("ally");
    expect(res.gated).toBe(true);
    expect(res.weights.boss).toBe(0);
  });
  it("is gated to ally when the player has not accepted the boss role", () => {
    const res = rollDropInRole(
      rollInput({ userSettings: settings({ acceptBossRole: false }) }),
      () => 0,
    );
    expect(res.gated).toBe(true);
  });
  it("is gated to ally outside a boss encounter", () => {
    const res = rollDropInRole(
      rollInput({ room: room({ currentPhase: "exploration" }) }),
      () => 0,
    );
    expect(res.gated).toBe(true);
  });
});

describe("rollDropInRole — weights", () => {
  it("boss encounter with a full party weights the boss at 75%", () => {
    // base 70/30 → boss encounter −30/+30 → party ≥3 −10/+10 ⇒ 30/70… clamp/verify ratio
    const res = rollDropInRole(rollInput(), () => 0.5);
    expect(res.weights).toEqual({ ally: 30, boss: 70 });
  });
  it("rng below the boss share yields the boss form", () => {
    const res = rollDropInRole(rollInput(), () => 0.1);
    expect(res.form).toBe("boss");
  });
  it("rng above the boss share yields the ally form", () => {
    const res = rollDropInRole(rollInput(), () => 0.99);
    expect(res.form).toBe("ally");
  });
  it("a used boss drop shifts weight back to ally", () => {
    const res = rollDropInRole(rollInput({ bossDropAlreadyUsed: true }), () => 0.5);
    expect(res.weights).toEqual({ ally: 60, boss: 40 });
  });
  it("weights never drop below 5 once gates pass", () => {
    const res = rollDropInRole(
      rollInput({ sceneIndex: 2, partySize: 1, partyHpFraction: 0.2, bossDropAlreadyUsed: true }),
      () => 0.5,
    );
    expect(res.weights.boss).toBeGreaterThanOrEqual(5);
    expect(res.weights.ally).toBeGreaterThanOrEqual(5);
  });
});
