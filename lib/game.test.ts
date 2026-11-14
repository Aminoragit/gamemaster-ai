import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetMemoryStore,
  bossAction,
  createRoom,
  dropInRoom,
  getOrCreateSoloRoom,
  getRoomSnapshot,
  getStore,
  isStubMode,
  joinRoom,
  kickMember,
  listLobby,
  sendFriendRequest,
  takeTurn,
} from "./game";
import { DEFAULT_DROPIN_SETTINGS } from "./session";

/** RNG that always returns a fixed face value, whatever the die size. */
const fixed = (face: number) => () => face;

beforeEach(() => {
  __resetMemoryStore();
});

describe("environment", () => {
  it("runs against the in-memory stub without Firebase keys", () => {
    expect(isStubMode()).toBe(true);
    expect(getStore().kind).toBe("memory");
  });
});

describe("room creation", () => {
  it("issues a 6-character code, seats the host and writes an opening scene", async () => {
    const snap = await createRoom({
      hostUid: "host-a", hostName: "Ana", title: "The Sunken Gate",
      genre: "Fantasy", tone: "Heroic", visibility: "public",
    });
    expect(snap.room.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(snap.members).toHaveLength(1);
    expect(snap.members[0].role).toBe("host");
    expect(snap.log.some((e) => e.type === "narration")).toBe(true);
    expect(snap.room.currentTurnUid).toBe("host-a");
  });
});

describe("solo loop", () => {
  it("runs a full cycle: action → dice → narration → sheet update → next scene", async () => {
    const solo = await getOrCreateSoloRoom("solo-1", "Ana");
    const code = solo.room.code;
    const before = solo.characters[solo.members[0].characterId];
    const result = await takeTurn(code, "solo-1", "Search the area", fixed(15));
    // 15 + INT 1 = 16 vs DC 12 → success
    expect(result.outcome).toBe("success");
    const types = result.snapshot.log.map((e) => e.type);
    expect(types).toContain("action");
    expect(types).toContain("dice");
    expect(types.filter((t) => t === "narration").length).toBeGreaterThanOrEqual(2);
    const after = result.snapshot.characters[before.id];
    expect(after.xp).toBe(before.xp + 20);
    expect(after.campaignLog.length).toBe(before.campaignLog.length + 1);
    expect(result.snapshot.room.sceneIndex).toBe(solo.room.sceneIndex + 1);
    expect(result.snapshot.room.sceneSummary.length).toBeGreaterThan(0);
    expect(result.snapshot.room.resolutionInFlight).toBe(false);
  });

  it("a failed check costs the hero HP", async () => {
    const solo = await getOrCreateSoloRoom("solo-2", "Ben");
    const charId = solo.members[0].characterId;
    const hp0 = solo.characters[charId].hp;
    const result = await takeTurn(solo.room.code, "solo-2", "Search the area", fixed(2));
    expect(result.outcome).toBe("failure");
    expect(result.snapshot.characters[charId].hp).toBe(hp0 - 3);
  });

  it("reuses the same solo room on repeat visits", async () => {
    const a = await getOrCreateSoloRoom("solo-3", "Cid");
    const b = await getOrCreateSoloRoom("solo-3", "Cid");
    expect(b.room.code).toBe(a.room.code);
  });
});

describe("multiplayer turns", () => {
  it("rotates the turn between party members", async () => {
    const snap = await createRoom({
      hostUid: "host-b", hostName: "Ana", title: "T", genre: "Fantasy", tone: "Heroic", visibility: "private",
    });
    await joinRoom(snap.room.code, "guest-b", "Ben");
    const after = await takeTurn(snap.room.code, "host-b", "Search the area", fixed(15));
    expect(after.snapshot.room.currentTurnUid).toBe("guest-b");
  });
});

describe("drop-in", () => {
  it("lands as an ally in the seeded boss room while a boss is already active", async () => {
    const res = await dropInRoom("K7QX2A", "drop-1", "New", DEFAULT_DROPIN_SETTINGS, () => 0);
    expect(res.form).toBe("ally");
    const member = res.snapshot.members.find((m) => m.uid === "drop-1");
    expect(member?.role).toBe("player");
    expect(member?.joinedVia).toBe("dropin");
    expect(res.snapshot.log.some((e) => e.type === "entrance")).toBe(true);
    expect(res.briefing.length).toBeGreaterThan(0);
  });

  it("respects the bilateral rule — a friends-only room stays closed to strangers", async () => {
    await expect(
      dropInRoom("M3TIDE", "drop-2", "New", DEFAULT_DROPIN_SETTINGS, () => 0),
    ).rejects.toThrow(/friends only/);
  });

  it("can land as the active boss when the gates pass and the roll favours it", async () => {
    const snap = await createRoom({
      hostUid: "host-c", hostName: "Ana", title: "Boss Night", genre: "Fantasy", tone: "Dark", visibility: "public",
    });
    const store = getStore();
    const room = await store.getRoom(snap.room.code);
    await store.saveRoom({ ...room!, currentPhase: "bossEncounter" });
    const res = await dropInRoom(snap.room.code, "drop-3", "Vex", DEFAULT_DROPIN_SETTINGS, () => 0);
    expect(res.form).toBe("boss");
    const member = res.snapshot.members.find((m) => m.uid === "drop-3");
    expect(member?.role).toBe("boss");
    const encounter = res.snapshot.encounters.find((e) => e.status === "active");
    expect(encounter?.boss.controlledByUid).toBe("drop-3");
    expect(res.snapshot.room.activeEncounterId).toBe(encounter?.id);
  });

  it("the boss player can act through the boss panel service calls", async () => {
    const snap = await createRoom({
      hostUid: "host-d", hostName: "Ana", title: "Boss Night", genre: "Fantasy", tone: "Dark", visibility: "public",
    });
    const store = getStore();
    const room = await store.getRoom(snap.room.code);
    await store.saveRoom({ ...room!, currentPhase: "bossEncounter" });
    await dropInRoom(snap.room.code, "drop-4", "Vex", DEFAULT_DROPIN_SETTINGS, () => 0);
    const hostCharId = snap.members[0].characterId;
    const hp0 = snap.characters[hostCharId].hp;
    const after = await bossAction(snap.room.code, "drop-4", "a1", fixed(5)); // 5 + 2 = 7 damage
    expect(after.characters[hostCharId].hp).toBe(hp0 - 7);
    const encounter = after.encounters.find((e) => e.status === "active");
    expect(encounter?.turnsLeft).toBe(9);
    expect(after.room.currentTurnUid).toBe("host-d");
  });

  it("the lobby only offers rooms the bilateral rule allows", async () => {
    const entries = await listLobby("lobby-user", DEFAULT_DROPIN_SETTINGS);
    const byCode = Object.fromEntries(entries.map((e) => [e.room.code, e]));
    expect(byCode["K7QX2A"].check.ok).toBe(true);
    expect(byCode["M3TIDE"].check.ok).toBe(false);
  });
});

describe("friends", () => {
  it("a request one way and a request back form a friendship", async () => {
    const req = await sendFriendRequest("f-a", "f-b");
    expect("status" in req && req.status).toBe("pending");
    const back = await sendFriendRequest("f-b", "f-a");
    expect("pairId" in back).toBe(true);
    const friendships = await getStore().getFriendships();
    expect(friendships.some((f) => f.uids.includes("f-a") && f.uids.includes("f-b"))).toBe(true);
  });
});

describe("kick → solo return bridge", () => {
  it("marks the member kicked, records it, and seeds their solo thread with a bridge scene", async () => {
    const snap = await createRoom({
      hostUid: "host-e", hostName: "Ana", title: "T", genre: "Fantasy", tone: "Heroic", visibility: "private",
    });
    await joinRoom(snap.room.code, "guest-e", "Ben");
    const result = await kickMember(snap.room.code, "host-e", "guest-e", "idle");
    const after = await getRoomSnapshot(snap.room.code);
    expect(after?.members.find((m) => m.uid === "guest-e")?.status).toBe("kicked");
    const records = await getStore().getKickRecords(snap.room.code, "guest-e");
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("host");
    const solo = await getRoomSnapshot(result.soloCode);
    expect(solo?.room.mode).toBe("solo");
    expect(solo?.log.some((e) => e.type === "narration" && e.text.includes("Meanwhile"))).toBe(true);
    // The kicked hero keeps their character sheet — nothing was copied or lost.
    expect(solo?.members[0].characterId).toBe(
      after?.members.find((m) => m.uid === "guest-e")?.characterId,
    );
  });

  it("only the host can kick", async () => {
    const snap = await createRoom({
      hostUid: "host-f", hostName: "Ana", title: "T", genre: "Fantasy", tone: "Heroic", visibility: "private",
    });
    await joinRoom(snap.room.code, "guest-f", "Ben");
    await expect(kickMember(snap.room.code, "guest-f", "host-f")).rejects.toThrow(/host/);
  });
});
