/**
 * Game service layer — BUILD_SPEC.md §4–§10.
 *
 * All Firestore access goes through the `GameStore` interface below.
 * Two implementations:
 *  - `FirestoreStore` — used when Firebase env vars are configured.
 *  - `MemoryStore` — in-memory stub used when they are not, so the
 *    complete loop (create → narrate → act → dice → adjudicate, drop-in,
 *    boss control, kick → solo return) runs locally with zero keys.
 *    Seeded with two demo public rooms so the lobby/drop-in demo works
 *    out of the box.
 *
 * AI generation is loaded dynamically from lib/ai.ts; when it reports a
 * stub result (unconfigured), local templates from lib/turn.ts keep the
 * narrative playable. State transitions are identical in both modes.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { ensureAnonAuth, firebaseReady, getDb } from "./firebase";
import { canDropIn, rollDropInRole } from "./dropin";
import type { Rng } from "./dice";
import {
  advancesScene,
  applyTurnToCharacter,
  checkEncounterEnd,
  createBossEncounter,
  diceLogText,
  localAdjudication,
  localBridge,
  localEntrance,
  localOpeningScene,
  localSummary,
  nextTurnUid,
  partyHitsBoss,
  resolveBossAbility,
  rollForAction,
} from "./turn";
import type {
  CharacterSheet,
  DropInEvent,
  DropInPolicy,
  DropInSettings,
  Encounter,
  FriendRequest,
  Friendship,
  Invite,
  KickRecord,
  KickVote,
  LogEntry,
  Room,
  RoomMember,
  UserDoc,
} from "./types";
import { friendshipPairId } from "./types";

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomCode(): string {
  return Array.from({ length: 6 }, () =>
    CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
  ).join("");
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const DEFAULT_POLICY: DropInPolicy = {
  mode: "anyone",
  bossAllowed: true,
  maxPlayers: 4,
  windows: { exploration: true, combat: true, bossEncounter: true },
  pauseDuringResolution: true,
};

export function defaultCharacter(ownerUid: string, displayName: string): CharacterSheet {
  return {
    id: newId("char"),
    ownerUid,
    name: displayName === "Adventurer" ? "Kael" : displayName,
    className: "Ranger",
    level: 3,
    xp: 0,
    hp: 21,
    maxHp: 26,
    stats: { str: 14, dex: 16, int: 12, cha: 13 },
    inventory: ["Shortbow", "Traveller's cloak", "Flint & steel"],
    campaignLog: [],
    updatedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* Store interface                                                     */
/* ------------------------------------------------------------------ */

export interface RoomSnapshot {
  room: Room;
  members: RoomMember[];
  log: LogEntry[];
  encounters: Encounter[];
  characters: Record<string, CharacterSheet>;
}

interface GameStore {
  readonly kind: "memory" | "firestore";
  getUser(uid: string): Promise<UserDoc | null>;
  saveUser(user: UserDoc & { uid: string }): Promise<void>;
  getCharacter(id: string): Promise<CharacterSheet | null>;
  saveCharacter(c: CharacterSheet): Promise<void>;
  findCharacterByOwner(uid: string): Promise<CharacterSheet | null>;
  saveRoom(room: Room): Promise<void>;
  getRoom(code: string): Promise<Room | null>;
  listPublicRooms(): Promise<Room[]>;
  findSoloRoom(uid: string): Promise<Room | null>;
  saveMember(code: string, m: RoomMember): Promise<void>;
  getMembers(code: string): Promise<RoomMember[]>;
  addLog(code: string, e: LogEntry): Promise<void>;
  getLog(code: string): Promise<LogEntry[]>;
  saveEncounter(code: string, e: Encounter): Promise<void>;
  getEncounters(code: string): Promise<Encounter[]>;
  saveFriendRequest(r: FriendRequest): Promise<void>;
  getFriendRequests(): Promise<FriendRequest[]>;
  saveFriendship(f: Friendship): Promise<void>;
  getFriendships(): Promise<Friendship[]>;
  getInvites(): Promise<Invite[]>;
  addKickRecord(r: KickRecord): Promise<void>;
  getKickRecords(code: string, uid: string): Promise<KickRecord[]>;
  addDropInEvent(e: DropInEvent): Promise<void>;
  getDropInEvents(code: string): Promise<DropInEvent[]>;
  saveKickVote(code: string, v: KickVote): Promise<void>;
  getKickVotes(code: string): Promise<KickVote[]>;
  subscribe(code: string, emit: () => void): () => void;
}

/* ------------------------------------------------------------------ */
/* MemoryStore — the no-keys stub backend                              */
/* ------------------------------------------------------------------ */

class MemoryStore implements GameStore {
  readonly kind = "memory" as const;
  users = new Map<string, UserDoc>();
  characters = new Map<string, CharacterSheet>();
  rooms = new Map<string, Room>();
  members = new Map<string, Map<string, RoomMember>>();
  logs = new Map<string, LogEntry[]>();
  encounters = new Map<string, Map<string, Encounter>>();
  friendRequests = new Map<string, FriendRequest>();
  friendships = new Map<string, Friendship>();
  invites: Invite[] = [];
  kickRecords: KickRecord[] = [];
  dropInEvents: DropInEvent[] = [];
  kickVotes = new Map<string, Map<string, KickVote>>();
  listeners = new Map<string, Set<() => void>>();

  constructor() {
    seedDemo(this);
  }

  emit(code: string) {
    this.listeners.get(code)?.forEach((fn) => fn());
  }

  async getUser(uid: string) { return this.users.get(uid) ?? null; }
  async saveUser(u: UserDoc & { uid: string }) { this.users.set(u.uid, u); }
  async getCharacter(id: string) { return this.characters.get(id) ?? null; }
  async saveCharacter(c: CharacterSheet) { this.characters.set(c.id, c); }
  async findCharacterByOwner(uid: string) {
    return [...this.characters.values()].find((c) => c.ownerUid === uid) ?? null;
  }
  async saveRoom(r: Room) { this.rooms.set(r.code, r); this.emit(r.code); }
  async getRoom(code: string) { return this.rooms.get(code) ?? null; }
  async listPublicRooms() {
    return [...this.rooms.values()].filter((r) => r.visibility === "public" && r.status === "playing");
  }
  async findSoloRoom(uid: string) {
    return [...this.rooms.values()].find(
      (r) => r.mode === "solo" && r.hostUid === uid && r.status !== "finished",
    ) ?? null;
  }
  async saveMember(code: string, m: RoomMember) {
    if (!this.members.has(code)) this.members.set(code, new Map());
    this.members.get(code)!.set(m.uid, m);
    this.emit(code);
  }
  async getMembers(code: string) {
    return [...(this.members.get(code)?.values() ?? [])].sort((a, b) => a.joinedAt - b.joinedAt);
  }
  async addLog(code: string, e: LogEntry) {
    if (!this.logs.has(code)) this.logs.set(code, []);
    this.logs.get(code)!.push(e);
    this.emit(code);
  }
  async getLog(code: string) {
    return [...(this.logs.get(code) ?? [])].sort((a, b) => a.at - b.at);
  }
  async saveEncounter(code: string, e: Encounter) {
    if (!this.encounters.has(code)) this.encounters.set(code, new Map());
    this.encounters.get(code)!.set(e.id, e);
    this.emit(code);
  }
  async getEncounters(code: string) {
    return [...(this.encounters.get(code)?.values() ?? [])];
  }
  async saveFriendRequest(r: FriendRequest) { this.friendRequests.set(r.id, r); }
  async getFriendRequests() { return [...this.friendRequests.values()]; }
  async saveFriendship(f: Friendship) { this.friendships.set(f.pairId, f); }
  async getFriendships() { return [...this.friendships.values()]; }
  async getInvites() { return this.invites; }
  async addKickRecord(r: KickRecord) { this.kickRecords.push(r); }
  async getKickRecords(code: string, uid: string) {
    return this.kickRecords.filter((r) => r.roomCode === code && r.targetUid === uid);
  }
  async addDropInEvent(e: DropInEvent) { this.dropInEvents.push(e); }
  async getDropInEvents(code: string) { return this.dropInEvents.filter((e) => e.roomCode === code); }
  async saveKickVote(code: string, v: KickVote) {
    if (!this.kickVotes.has(code)) this.kickVotes.set(code, new Map());
    this.kickVotes.get(code)!.set(v.id, v);
    this.emit(code);
  }
  async getKickVotes(code: string) { return [...(this.kickVotes.get(code)?.values() ?? [])]; }
  subscribe(code: string, emit: () => void) {
    if (!this.listeners.has(code)) this.listeners.set(code, new Set());
    this.listeners.get(code)!.add(emit);
    return () => { this.listeners.get(code)?.delete(emit); };
  }
}

function seedDemo(store: MemoryStore) {
  const now = Date.now();
  const mkChar = (id: string, ownerUid: string, name: string, className: string): CharacterSheet => ({
    id, ownerUid, name, className, level: 3, xp: 0, hp: 22, maxHp: 26,
    stats: { str: 14, dex: 16, int: 12, cha: 13 }, inventory: [], campaignLog: [], updatedAt: now,
  });
  store.characters.set("c-host-1", mkChar("c-host-1", "u-host-1", "Seok", "Fighter"));
  store.characters.set("c-u2", mkChar("c-u2", "u-2", "Mira", "Rogue"));
  store.characters.set("c-u3", mkChar("c-u3", "u-3", "Jae", "Warlock"));
  store.characters.set("c-host-2", mkChar("c-host-2", "u-host-2", "Rin", "Bard"));

  const gate: Room = {
    code: "K7QX2A", hostUid: "u-host-1", title: "The Sunken Gate", genre: "Fantasy", tone: "Heroic",
    mode: "party", visibility: "public", status: "playing",
    dropInPolicy: structuredClone(DEFAULT_POLICY),
    sceneSummary: "The party has just reached the flooded gatehouse as something enormous stirs beneath the water.",
    sceneIndex: 8, currentPhase: "bossEncounter", currentTurnUid: "u-host-1",
    resolutionInFlight: false, activeEncounterId: "enc-1", createdAt: now, updatedAt: now,
  };
  const tide: Room = {
    code: "M3TIDE", hostUid: "u-host-2", title: "Salt & Smoke", genre: "Pirate mystery", tone: "Gritty",
    mode: "party", visibility: "public", status: "playing",
    dropInPolicy: { ...structuredClone(DEFAULT_POLICY), mode: "friends", bossAllowed: false, maxPlayers: 3,
      windows: { exploration: true, combat: false, bossEncounter: false } },
    sceneSummary: "A smuggler's skiff slips out of the harbour at dusk.",
    sceneIndex: 2, currentPhase: "exploration", currentTurnUid: "u-host-2",
    resolutionInFlight: false, activeEncounterId: null, createdAt: now, updatedAt: now,
  };
  store.rooms.set(gate.code, gate);
  store.rooms.set(tide.code, tide);
  store.members.set(gate.code, new Map<string, RoomMember>([
    ["u-host-1", { uid: "u-host-1", role: "host", characterId: "c-host-1", displayName: "Seok", joinedVia: "create", status: "active", joinedAt: now }],
    ["u-2", { uid: "u-2", role: "player", characterId: "c-u2", displayName: "Mira", joinedVia: "code", status: "active", joinedAt: now + 1 }],
    ["u-3", { uid: "u-3", role: "boss", characterId: "c-u3", displayName: "Jae", joinedVia: "dropin", status: "active", joinedAt: now + 2 }],
  ]));
  store.members.set(tide.code, new Map<string, RoomMember>([
    ["u-host-2", { uid: "u-host-2", role: "host", characterId: "c-host-2", displayName: "Rin", joinedVia: "create", status: "active", joinedAt: now }],
  ]));
  store.logs.set(gate.code, [
    { id: "seed-l1", type: "narration", authorUid: null, text: "Rain hammers the flooded gatehouse. Beyond the portcullis, something enormous shifts in the dark water.", route: "in_cloud", dice: null, at: now },
    { id: "seed-l2", type: "npc", authorUid: null, text: "Gatekeeper: \"State your business — quickly, before it wakes.\"", route: "on_device", dice: null, at: now + 1 },
    { id: "seed-l3", type: "entrance", authorUid: null, text: "The water bulges. Two amber eyes open beneath the surface — the Gate Serpent was never asleep.", route: "in_cloud", dice: null, at: now + 2 },
  ]);
  store.logs.set(tide.code, [
    { id: "seed-t1", type: "narration", authorUid: null, text: "Lanterns swing over the harbour as Rin's crew readies the skiff.", route: "in_cloud", dice: null, at: now },
  ]);
  const enc = createBossEncounter("enc-1", gate, "u-3", ["u-host-1", "u-2", "u-3"], now);
  enc.boss.hp = 64;
  enc.boss.menace = 45;
  store.encounters.set(gate.code, new Map([["enc-1", enc]]));
  store.friendships.set(friendshipPairId("local-demo", "u-host-2"), {
    pairId: friendshipPairId("local-demo", "u-host-2"), uids: ["local-demo", "u-host-2"], since: now,
  });
}

/* ------------------------------------------------------------------ */
/* FirestoreStore — live backend (configured via .env.local)           */
/* ------------------------------------------------------------------ */

class FirestoreStore implements GameStore {
  readonly kind = "firestore" as const;
  private db(): Firestore {
    const db = getDb();
    if (!db) throw new Error("Firestore is not configured");
    return db;
  }
  /** db() gated on an anonymous Auth session (rules require request.auth). */
  private async dbAsync(): Promise<Firestore> {
    await ensureAnonAuth();
    return this.db();
  }
  async getUser(uid: string) {
    const s = await getDoc(doc((await this.dbAsync()), "users", uid));
    return s.exists() ? (s.data() as UserDoc) : null;
  }
  async saveUser(u: UserDoc & { uid?: string }) {
    if (!u.uid) return;
    await setDoc(doc((await this.dbAsync()), "users", u.uid), u, { merge: true });
  }
  async getCharacter(id: string) {
    const s = await getDoc(doc((await this.dbAsync()), "characters", id));
    return s.exists() ? (s.data() as CharacterSheet) : null;
  }
  async saveCharacter(c: CharacterSheet) {
    await setDoc(doc((await this.dbAsync()), "characters", c.id), c, { merge: true });
  }
  async findCharacterByOwner(uid: string) {
    const q = query(collection((await this.dbAsync()), "characters"), where("ownerUid", "==", uid));
    const s = await getDocs(q);
    return s.empty ? null : (s.docs[0].data() as CharacterSheet);
  }
  async saveRoom(r: Room) { await setDoc(doc((await this.dbAsync()), "rooms", r.code), r, { merge: true }); }
  async getRoom(code: string) {
    const s = await getDoc(doc((await this.dbAsync()), "rooms", code));
    return s.exists() ? (s.data() as Room) : null;
  }
  async listPublicRooms() {
    const q = query(
      collection((await this.dbAsync()), "rooms"),
      where("visibility", "==", "public"),
      where("status", "==", "playing"),
    );
    return (await getDocs(q)).docs.map((d) => d.data() as Room);
  }
  async findSoloRoom(uid: string) {
    const q = query(
      collection((await this.dbAsync()), "rooms"),
      where("hostUid", "==", uid),
      where("mode", "==", "solo"),
    );
    const s = await getDocs(q);
    const rooms = s.docs.map((d) => d.data() as Room).filter((r) => r.status !== "finished");
    return rooms[0] ?? null;
  }
  async saveMember(code: string, m: RoomMember) {
    await setDoc(doc((await this.dbAsync()), "rooms", code, "members", m.uid), m, { merge: true });
  }
  async getMembers(code: string) {
    const s = await getDocs(collection((await this.dbAsync()), "rooms", code, "members"));
    return s.docs.map((d) => d.data() as RoomMember).sort((a, b) => a.joinedAt - b.joinedAt);
  }
  async addLog(code: string, e: LogEntry) {
    await setDoc(doc((await this.dbAsync()), "rooms", code, "log", e.id), e);
  }
  async getLog(code: string) {
    const s = await getDocs(collection((await this.dbAsync()), "rooms", code, "log"));
    return s.docs.map((d) => d.data() as LogEntry).sort((a, b) => a.at - b.at);
  }
  async saveEncounter(code: string, e: Encounter) {
    await setDoc(doc((await this.dbAsync()), "rooms", code, "encounters", e.id), e, { merge: true });
  }
  async getEncounters(code: string) {
    const s = await getDocs(collection((await this.dbAsync()), "rooms", code, "encounters"));
    return s.docs.map((d) => d.data() as Encounter);
  }
  async saveFriendRequest(r: FriendRequest) {
    await setDoc(doc((await this.dbAsync()), "friendRequests", r.id), r, { merge: true });
  }
  async getFriendRequests() {
    return (await getDocs(collection((await this.dbAsync()), "friendRequests"))).docs.map((d) => d.data() as FriendRequest);
  }
  async saveFriendship(f: Friendship) {
    await setDoc(doc((await this.dbAsync()), "friendships", f.pairId), f, { merge: true });
  }
  async getFriendships() {
    return (await getDocs(collection((await this.dbAsync()), "friendships"))).docs.map((d) => d.data() as Friendship);
  }
  async getInvites() {
    return (await getDocs(collection((await this.dbAsync()), "invites"))).docs.map((d) => d.data() as Invite);
  }
  async addKickRecord(r: KickRecord) { await setDoc(doc((await this.dbAsync()), "kickRecords", r.id), r); }
  async getKickRecords(code: string, uid: string) {
    const q = query(
      collection((await this.dbAsync()), "kickRecords"),
      where("roomCode", "==", code),
      where("targetUid", "==", uid),
    );
    return (await getDocs(q)).docs.map((d) => d.data() as KickRecord);
  }
  async addDropInEvent(e: DropInEvent) { await setDoc(doc((await this.dbAsync()), "dropInEvents", e.id), e); }
  async getDropInEvents(code: string) {
    const q = query(collection((await this.dbAsync()), "dropInEvents"), where("roomCode", "==", code));
    return (await getDocs(q)).docs.map((d) => d.data() as DropInEvent);
  }
  async saveKickVote(code: string, v: KickVote) {
    await setDoc(doc((await this.dbAsync()), "rooms", code, "kickVotes", v.id), v, { merge: true });
  }
  async getKickVotes(code: string) {
    const s = await getDocs(collection((await this.dbAsync()), "rooms", code, "kickVotes"));
    return s.docs.map((d) => d.data() as KickVote);
  }
  subscribe(code: string, emit: () => void) {
    // Listeners attached before sign-in would be denied by the rules and
    // terminated, so attach only once the anonymous session exists.
    let unsubs: Array<() => void> = [];
    let cancelled = false;
    void ensureAnonAuth().then(() => {
      if (cancelled) return;
      const db = this.db();
      unsubs = [
        onSnapshot(doc(db, "rooms", code), emit),
        onSnapshot(collection(db, "rooms", code, "members"), emit),
        onSnapshot(collection(db, "rooms", code, "log"), emit),
        onSnapshot(collection(db, "rooms", code, "encounters"), emit),
      ];
    });
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }
}

/* ------------------------------------------------------------------ */
/* Store selection                                                     */
/* ------------------------------------------------------------------ */

const globalRef = globalThis as typeof globalThis & { __gmMemoryStore?: MemoryStore };
function memoryStore(): MemoryStore {
  globalRef.__gmMemoryStore ??= new MemoryStore();
  return globalRef.__gmMemoryStore;
}

export function getStore(): GameStore {
  return firebaseReady ? new FirestoreStore() : memoryStore();
}

export function isStubMode(): boolean {
  return !firebaseReady;
}

/** Test hook — wipe the in-memory backend back to its seeded state. */
export function __resetMemoryStore(): void {
  globalRef.__gmMemoryStore = new MemoryStore();
}

/* ------------------------------------------------------------------ */
/* Snapshot assembly & subscription                                    */
/* ------------------------------------------------------------------ */

export async function getRoomSnapshot(code: string): Promise<RoomSnapshot | null> {
  const store = getStore();
  const room = await store.getRoom(code.toUpperCase());
  if (!room) return null;
  const [members, log, encounters] = await Promise.all([
    store.getMembers(room.code),
    store.getLog(room.code),
    store.getEncounters(room.code),
  ]);
  const characters: Record<string, CharacterSheet> = {};
  await Promise.all(
    members.map(async (m) => {
      const c = await store.getCharacter(m.characterId);
      if (c) characters[c.id] = c;
    }),
  );
  return { room, members, log, encounters, characters };
}

export function subscribeRoom(code: string, cb: (snap: RoomSnapshot | null) => void): () => void {
  const store = getStore();
  let live = true;
  const push = () => {
    void getRoomSnapshot(code).then((snap) => { if (live) cb(snap); });
  };
  const unsub = store.subscribe(code.toUpperCase(), push);
  push();
  return () => { live = false; unsub(); };
}

/* ------------------------------------------------------------------ */
/* Users & characters                                                  */
/* ------------------------------------------------------------------ */

export async function ensureUser(
  uid: string,
  displayName: string,
  settings: DropInSettings,
): Promise<UserDoc> {
  const store = getStore();
  const existing = await store.getUser(uid);
  const user: UserDoc & { uid: string } = {
    uid,
    displayName,
    settings: { dropIn: settings },
    badges: existing?.badges ?? [],
    createdAt: existing?.createdAt ?? Date.now(),
  };
  await store.saveUser(user);
  return user;
}

export async function getOrCreateCharacter(uid: string, displayName: string): Promise<CharacterSheet> {
  const store = getStore();
  const existing = await store.findCharacterByOwner(uid);
  if (existing) return existing;
  const character = defaultCharacter(uid, displayName);
  await store.saveCharacter(character);
  return character;
}

/* ------------------------------------------------------------------ */
/* AI access (dynamic — keeps lib/ai.ts out of the test import graph)  */
/* ------------------------------------------------------------------ */

type AiModule = typeof import("./ai");
let aiModule: AiModule | null = null;
async function ai(): Promise<AiModule | null> {
  if (aiModule) return aiModule;
  try {
    aiModule = await import("./ai");
    return aiModule;
  } catch {
    return null;
  }
}

async function cloudText(prompt: string, fallback: () => string): Promise<{ text: string; route: "in_cloud" | "on_device" }> {
  const m = await ai();
  if (!m) return { text: fallback(), route: "in_cloud" };
  const res = await m.generateCloud(prompt);
  return res.stub ? { text: fallback(), route: res.route } : { text: res.text, route: res.route };
}

async function hybridText(prompt: string, fallback: () => string): Promise<{ text: string; route: "in_cloud" | "on_device" }> {
  const m = await ai();
  if (!m) return { text: fallback(), route: "on_device" };
  const res = await m.generateHybrid(prompt);
  return res.stub ? { text: fallback(), route: res.route } : { text: res.text, route: res.route };
}

/* ------------------------------------------------------------------ */
/* Room creation                                                       */
/* ------------------------------------------------------------------ */

export interface CreateRoomInput {
  hostUid: string;
  hostName: string;
  title: string;
  genre: string;
  tone: string;
  visibility: "public" | "private";
  dropInPolicy?: DropInPolicy;
}

async function uniqueCode(store: GameStore): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = randomCode();
    if (!(await store.getRoom(code))) return code;
  }
  return newId("room").slice(0, 6).toUpperCase();
}

export async function createRoom(input: CreateRoomInput): Promise<RoomSnapshot> {
  const store = getStore();
  const now = Date.now();
  const character = await getOrCreateCharacter(input.hostUid, input.hostName);
  const code = await uniqueCode(store);
  const room: Room = {
    code,
    hostUid: input.hostUid,
    title: input.title,
    genre: input.genre,
    tone: input.tone,
    mode: "party",
    visibility: input.visibility,
    status: "playing",
    dropInPolicy: input.dropInPolicy ?? structuredClone(DEFAULT_POLICY),
    sceneSummary: `${character.name} begins “${input.title}”.`,
    sceneIndex: 1,
    currentPhase: "exploration",
    currentTurnUid: input.hostUid,
    resolutionInFlight: false,
    activeEncounterId: null,
    createdAt: now,
    updatedAt: now,
  };
  await store.saveRoom(room);
  await store.saveMember(code, {
    uid: input.hostUid, role: "host", characterId: character.id,
    displayName: input.hostName, joinedVia: "create", status: "active", joinedAt: now,
  });
  const m = await ai();
  const opening = await cloudText(
    m ? m.narrationPrompt("", [], `Begin the adventure “${input.title}” (${input.genre}, ${input.tone})`) : "",
    () => localOpeningScene(input.title, input.genre, character.name),
  );
  await store.addLog(code, {
    id: newId("log"), type: "narration", authorUid: null,
    text: opening.text, route: opening.route, dice: null, at: now + 1,
  });
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error("Room creation failed");
  return snap;
}

/** The one-member solo room (§5) — created on demand, reused after. */
export async function getOrCreateSoloRoom(uid: string, displayName: string): Promise<RoomSnapshot> {
  const store = getStore();
  const existing = await store.findSoloRoom(uid);
  if (existing) {
    const snap = await getRoomSnapshot(existing.code);
    if (snap) return snap;
  }
  const character = await getOrCreateCharacter(uid, displayName);
  const now = Date.now();
  const code = await uniqueCode(store);
  const room: Room = {
    code, hostUid: uid, title: `Solo Campaign`, genre: "Fantasy", tone: "Heroic",
    mode: "solo", visibility: "private", status: "playing",
    dropInPolicy: { ...structuredClone(DEFAULT_POLICY), mode: "off", bossAllowed: false },
    sceneSummary: `${character.name} travels alone — for now.`,
    sceneIndex: 1, currentPhase: "exploration", currentTurnUid: uid,
    resolutionInFlight: false, activeEncounterId: null, createdAt: now, updatedAt: now,
  };
  await store.saveRoom(room);
  await store.saveMember(code, {
    uid, role: "host", characterId: character.id, displayName,
    joinedVia: "create", status: "active", joinedAt: now,
  });
  await store.addLog(code, {
    id: newId("log"), type: "narration", authorUid: null,
    text: localOpeningScene("the open road", "Fantasy", character.name),
    route: "in_cloud", dice: null, at: now + 1,
  });
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error("Solo room creation failed");
  return snap;
}

/* ------------------------------------------------------------------ */
/* Joining & drop-in                                                   */
/* ------------------------------------------------------------------ */

export async function joinRoom(
  code: string,
  uid: string,
  displayName: string,
  via: "code" | "invite" = "code",
): Promise<RoomSnapshot> {
  const store = getStore();
  code = code.toUpperCase();
  const room = await store.getRoom(code);
  if (!room) throw new Error("Room not found");
  const members = await store.getMembers(code);
  const existing = members.find((m) => m.uid === uid);
  if (existing?.status === "active") {
    const snap = await getRoomSnapshot(code);
    if (!snap) throw new Error("Room not found");
    return snap;
  }
  if (existing?.status === "kicked") {
    const records = await store.getKickRecords(code, uid);
    const last = records.sort((a, b) => b.at - a.at)[0];
    if (last && Date.now() - last.at < 24 * 3600_000) {
      throw new Error("You were removed from this room and cannot rejoin for 24 hours");
    }
  }
  const character = await getOrCreateCharacter(uid, displayName);
  await store.saveMember(code, {
    uid, role: "player", characterId: character.id, displayName,
    joinedVia: via, status: "active", joinedAt: Date.now(),
  });
  await store.addLog(code, {
    id: newId("log"), type: "system", authorUid: null,
    text: `${displayName} joined the game.`, route: null, dice: null, at: Date.now(),
  });
  if (!room.currentTurnUid) await store.saveRoom({ ...room, currentTurnUid: uid, updatedAt: Date.now() });
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error("Room not found");
  return snap;
}

export interface LobbyEntry {
  room: Room;
  partySize: number;
  isFriendOfMember: boolean;
  hasInvite: boolean;
  check: ReturnType<typeof canDropIn>;
}

export async function listLobby(uid: string, settings: DropInSettings): Promise<LobbyEntry[]> {
  const store = getStore();
  const [rooms, friendships, invites] = await Promise.all([
    store.listPublicRooms(),
    store.getFriendships(),
    store.getInvites(),
  ]);
  const friendUids = new Set(
    friendships.filter((f) => f.uids.includes(uid)).flatMap((f) => f.uids).filter((x) => x !== uid),
  );
  const entries: LobbyEntry[] = [];
  for (const room of rooms) {
    if (room.hostUid === uid) continue;
    const members = await store.getMembers(room.code);
    const active = members.filter((m) => m.status === "active");
    const partySize = active.filter((m) => m.role !== "boss").length;
    const isFriendOfMember = active.some((m) => friendUids.has(m.uid));
    const hasInvite = invites.some(
      (i) => i.roomCode === room.code && i.toUid === uid && i.status === "pending" && i.expiresAt > Date.now(),
    );
    entries.push({
      room, partySize, isFriendOfMember, hasInvite,
      check: canDropIn({ room, userSettings: settings, isFriendOfMember, hasInvite, partySize }),
    });
  }
  return entries;
}

export interface DropInResult {
  form: "ally" | "boss";
  weights: { ally: number; boss: number };
  factors: string[];
  briefing: string;
  snapshot: RoomSnapshot;
}

/** Full drop-in flow (§6–§8): policy check → weighted role roll → entrance staging. */
export async function dropInRoom(
  code: string,
  uid: string,
  displayName: string,
  settings: DropInSettings,
  roleRng: () => number = Math.random,
): Promise<DropInResult> {
  const store = getStore();
  code = code.toUpperCase();
  const room = await store.getRoom(code);
  if (!room) throw new Error("Room not found");
  const snap0 = await getRoomSnapshot(code);
  if (!snap0) throw new Error("Room not found");
  if (snap0.members.some((m) => m.uid === uid && m.status === "active")) {
    return { form: "ally", weights: { ally: 100, boss: 0 }, factors: ["already in the room"], briefing: room.sceneSummary, snapshot: snap0 };
  }

  const [friendships, invites, events] = await Promise.all([
    store.getFriendships(),
    store.getInvites(),
    store.getDropInEvents(code),
  ]);
  const friendUids = new Set(
    friendships.filter((f) => f.uids.includes(uid)).flatMap((f) => f.uids).filter((x) => x !== uid),
  );
  const active = snap0.members.filter((m) => m.status === "active");
  const party = active.filter((m) => m.role !== "boss");
  const isFriendOfMember = active.some((m) => friendUids.has(m.uid));
  const hasInvite = invites.some(
    (i) => i.roomCode === code && i.toUid === uid && i.status === "pending" && i.expiresAt > Date.now(),
  );
  const check = canDropIn({ room, userSettings: settings, isFriendOfMember, hasInvite, partySize: party.length });
  if (!check.ok) throw new Error(check.reason);

  const partyChars = party.map((m) => snap0.characters[m.characterId]).filter(Boolean);
  const partyHpFraction = partyChars.length
    ? partyChars.reduce((a, c) => a + c.hp / Math.max(1, c.maxHp), 0) / partyChars.length
    : 1;
  const roll = rollDropInRole(
    {
      room,
      userSettings: settings,
      partySize: party.length,
      sceneIndex: room.sceneIndex,
      partyHpFraction,
      bossDropAlreadyUsed: events.some((e) => e.form === "boss"),
      bossCurrentlyActive: active.some((m) => m.role === "boss"),
    },
    roleRng,
  );

  const character = await getOrCreateCharacter(uid, displayName);
  const now = Date.now();
  await store.saveMember(code, {
    uid, role: roll.form === "boss" ? "boss" : "player", characterId: character.id,
    displayName, joinedVia: "dropin", status: "active", joinedAt: now,
  });
  await store.addDropInEvent({
    id: newId("drop"), roomCode: code, uid, form: roll.form,
    weights: roll.weights, factors: roll.factors, rolledAt: now,
  });

  // Boss form: attach to (or create) the room's active boss encounter (§7.4).
  let bossName: string | undefined;
  if (roll.form === "boss") {
    let encounter = snap0.encounters.find((e) => e.status === "active");
    if (encounter && !encounter.boss.controlledByUid) {
      encounter = { ...encounter, boss: { ...encounter.boss, controlledByUid: uid } };
    } else if (!encounter) {
      const order = [...party.map((m) => m.uid), uid];
      encounter = createBossEncounter(newId("enc"), room, uid, order, now);
    }
    bossName = encounter.boss.name;
    await store.saveEncounter(code, encounter);
    await store.saveRoom({
      ...room, activeEncounterId: encounter.id, currentPhase: "bossEncounter",
      currentTurnUid: uid, updatedAt: now,
    });
  }

  // Entrance staging (§8.1) — revealed in-fiction before the entrant acts.
  const m = await ai();
  const recent = snap0.log.slice(-5).map((e) => e.text);
  const entrance = await cloudText(
    m
      ? m.entrancePrompt({
          form: roll.form, sceneSummary: room.sceneSummary, recentLog: recent,
          partyRoster: party.map((p) => p.displayName),
          entrantName: character.name, entrantDetail: `${character.className}, level ${character.level}`,
        })
      : "",
    () => localEntrance(roll.form, character.name, bossName),
  );
  await store.addLog(code, {
    id: newId("log"), type: "entrance", authorUid: null,
    text: entrance.text, route: entrance.route, dice: null, at: Date.now(),
  });

  const snapshot = await getRoomSnapshot(code);
  if (!snapshot) throw new Error("Room not found");
  return { form: roll.form, weights: roll.weights, factors: roll.factors, briefing: room.sceneSummary, snapshot };
}

/* ------------------------------------------------------------------ */
/* The turn (§4)                                                       */
/* ------------------------------------------------------------------ */

export interface TurnResult {
  snapshot: RoomSnapshot;
  diceText: string;
  outcome: string;
}

export async function takeTurn(
  code: string,
  uid: string,
  actionText: string,
  rng?: Rng,
): Promise<TurnResult> {
  const store = getStore();
  code = code.toUpperCase();
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error("Room not found");
  const { room } = snap;
  const member = snap.members.find((m) => m.uid === uid && m.status === "active");
  if (!member) throw new Error("You are not an active member of this room");
  const character0 = snap.characters[member.characterId];
  if (!character0) throw new Error("Character sheet not found");
  const action = actionText.trim();
  if (!action) throw new Error("Describe what you do first");

  await store.saveRoom({ ...room, resolutionInFlight: true, updatedAt: Date.now() });

  // 1) The player's action lands in the shared log.
  await store.addLog(code, {
    id: newId("log"), type: "action", authorUid: uid,
    text: `${character0.name}: ${action}`, route: null, dice: null, at: Date.now(),
  });

  // 2) Dice check — client-side engine, recorded in the log (§4.3).
  const { stat, dice } = rollForAction(character0, action, room.currentPhase, rng);
  const diceText = diceLogText(character0.name, stat.label, dice);
  await store.addLog(code, {
    id: newId("log"), type: "dice", authorUid: uid,
    text: diceText, route: null, dice, at: Date.now(),
  });

  // 3) Cloud adjudication (§4.4), with the dice outcome fixed by contract.
  const m = await ai();
  const recent = snap.log.slice(-5).map((e) => e.text);
  const narration = await cloudText(
    m ? m.adjudicationPrompt(room.sceneSummary, action, dice) : "",
    () => localAdjudication(action, dice, character0.name),
  );
  await store.addLog(code, {
    id: newId("log"), type: "narration", authorUid: null,
    text: narration.text, route: narration.route, dice: null, at: Date.now(),
  });

  // Boss encounter: a successful party action wounds the boss (§7.4).
  let encounter = snap.encounters.find((e) => e.id === room.activeEncounterId && e.status === "active")
    ?? snap.encounters.find((e) => e.status === "active");
  let encounterEnded: Encounter | null = null;
  if (encounter && member.role !== "boss" && advancesScene(dice)) {
    const hit = partyHitsBoss(encounter, rng);
    encounter = hit.encounter;
    await store.addLog(code, {
      id: newId("log"), type: "system", authorUid: null,
      text: `${character0.name}'s success wounds ${encounter.boss.name} for ${hit.damage}! (Boss HP ${encounter.boss.hp}/${encounter.boss.maxHp})`,
      route: null, dice: null, at: Date.now(),
    });
    if (hit.defeated) encounterEnded = encounter;
    else await store.saveEncounter(code, encounter);
  }

  // 4) Consequences write back to the one shared character sheet (§5).
  const milestone = `${action} — ${dice.outcome.replace(/_/g, " ")}`;
  const { character } = applyTurnToCharacter(character0, dice, Date.now(), milestone);
  await store.saveCharacter(character);

  // 5) Scene summary refresh — hybrid, on-device preferred (§4.6).
  const summary = await hybridText(
    m ? m.sceneSummaryPrompt(room.sceneSummary, [...recent.slice(-3), narration.text]) : "",
    () => localSummary(room.sceneSummary, [narration.text]),
  );

  // 6) Encounter end / turn rotation (§4.5).
  let activeEncounterId = room.activeEncounterId;
  if (encounterEnded) {
    await store.saveEncounter(code, encounterEnded);
    activeEncounterId = null;
    const bossMember = snap.members.find((mm) => mm.role === "boss" && mm.status === "active");
    if (bossMember) {
      await store.saveMember(code, { ...bossMember, role: "player" });
      await store.addLog(code, {
        id: newId("log"), type: "system", authorUid: null,
        text: `${encounterEnded.boss.name} falls! ${bossMember.displayName} joins the party as an ally.`,
        route: null, dice: null, at: Date.now(),
      });
    }
  }
  const activeMembers = snap.members.filter((mm) => mm.status === "active");
  const order = encounter && !encounterEnded
    ? encounter.turnOrder
    : activeMembers.filter((mm) => mm.role !== "boss").map((mm) => mm.uid);
  const nextUid = room.mode === "solo" ? uid : nextTurnUid(order.length ? order : [uid], uid);

  await store.saveRoom({
    ...room,
    resolutionInFlight: false,
    sceneSummary: summary.text,
    sceneIndex: room.sceneIndex + (advancesScene(dice) ? 1 : 0),
    currentPhase: encounterEnded ? "exploration" : room.currentPhase,
    activeEncounterId,
    currentTurnUid: nextUid,
    updatedAt: Date.now(),
  });

  const snapshot = await getRoomSnapshot(code);
  if (!snapshot) throw new Error("Room not found");
  return { snapshot, diceText, outcome: dice.outcome };
}

/* ------------------------------------------------------------------ */
/* Boss actions (§7.4)                                                 */
/* ------------------------------------------------------------------ */

export async function bossAction(code: string, uid: string, abilityId: string, rng?: Rng): Promise<RoomSnapshot> {
  const store = getStore();
  code = code.toUpperCase();
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error("Room not found");
  const encounter0 = snap.encounters.find((e) => e.status === "active");
  if (!encounter0 || encounter0.boss.controlledByUid !== uid) {
    throw new Error("You are not controlling the boss right now");
  }
  const partyMembers = snap.members.filter((m) => m.status === "active" && m.role !== "boss");
  const partyChars = partyMembers.map((m) => snap.characters[m.characterId]).filter(Boolean);
  if (!partyChars.length) throw new Error("No party to menace");
  const target = [...partyChars].sort((a, b) => a.hp - b.hp)[0];

  const result = resolveBossAbility(encounter0, abilityId, rng);
  const hurt = { ...target, hp: Math.max(0, target.hp - result.damage), updatedAt: Date.now() };
  await store.saveCharacter(hurt);
  await store.addLog(code, {
    id: newId("log"), type: "action", authorUid: uid,
    text: `👹 ${encounter0.boss.name} uses ${result.abilityName} — ${result.damage} damage to ${target.name}!`,
    route: null, dice: null, at: Date.now(),
  });

  const partyHp = partyChars.map((c) => (c.id === hurt.id ? hurt.hp : c.hp));
  const encounter = checkEncounterEnd(result.encounter, partyHp, Date.now());
  await store.saveEncounter(code, encounter);

  const room = snap.room;
  if (encounter.status !== "active") {
    const bossMember = snap.members.find((m) => m.uid === uid);
    if (bossMember) await store.saveMember(code, { ...bossMember, role: "player", status: "active" });
    const endText =
      encounter.status === "won"
        ? `👹 The boss triumphs — the party is overwhelmed! ${snap.members.find((m) => m.uid === uid)?.displayName ?? "The boss player"} earns the Menace badge.`
        : `The encounter ends in a draw — the party was delayed, which counts as a partial boss victory.`;
    await store.addLog(code, {
      id: newId("log"), type: "system", authorUid: null, text: endText, route: null, dice: null, at: Date.now(),
    });
    await store.saveRoom({
      ...room, activeEncounterId: null, currentPhase: "exploration",
      currentTurnUid: partyMembers[0]?.uid ?? room.hostUid, updatedAt: Date.now(),
    });
  } else {
    await store.saveRoom({
      ...room, currentTurnUid: nextTurnUid(encounter.turnOrder, uid), updatedAt: Date.now(),
    });
  }
  const snapshot = await getRoomSnapshot(code);
  if (!snapshot) throw new Error("Room not found");
  return snapshot;
}

/** Boss taunt — a hybrid on-device line in the boss's voice (§7.4). */
export async function bossTaunt(code: string, uid: string): Promise<RoomSnapshot> {
  const store = getStore();
  code = code.toUpperCase();
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error("Room not found");
  const encounter = snap.encounters.find((e) => e.status === "active");
  if (!encounter || encounter.boss.controlledByUid !== uid) throw new Error("You are not the boss");
  const m = await ai();
  const line = await hybridText(
    m ? m.npcLinePrompt(encounter.boss.name, "Taunt the adventuring party that dares to face you") : "",
    () => `${encounter.boss.name}: "Your torches flicker, little heroes. The water is patient — I am not."`,
  );
  await store.addLog(code, {
    id: newId("log"), type: "npc", authorUid: uid,
    text: line.text, route: line.route, dice: null, at: Date.now(),
  });
  const snapshot = await getRoomSnapshot(code);
  if (!snapshot) throw new Error("Room not found");
  return snapshot;
}

/* ------------------------------------------------------------------ */
/* Friends (§9)                                                        */
/* ------------------------------------------------------------------ */

export async function sendFriendRequest(fromUid: string, toUid: string): Promise<FriendRequest | Friendship> {
  const store = getStore();
  if (fromUid === toUid) throw new Error("You cannot friend yourself");
  const pairId = friendshipPairId(fromUid, toUid);
  const friendships = await store.getFriendships();
  const existingFriendship = friendships.find((f) => f.pairId === pairId);
  if (existingFriendship) return existingFriendship;
  const requests = await store.getFriendRequests();
  const reverse = requests.find((r) => r.fromUid === toUid && r.toUid === fromUid && r.status === "pending");
  if (reverse) {
    // Mutual interest — accept on the spot.
    const accepted: FriendRequest = { ...reverse, status: "accepted" };
    await store.saveFriendRequest(accepted);
    const friendship: Friendship = { pairId, uids: [fromUid, toUid], since: Date.now() };
    await store.saveFriendship(friendship);
    return friendship;
  }
  const same = requests.find((r) => r.fromUid === fromUid && r.toUid === toUid && r.status === "pending");
  if (same) return same;
  const req: FriendRequest = { id: newId("fr"), fromUid, toUid, status: "pending", at: Date.now() };
  await store.saveFriendRequest(req);
  return req;
}

export async function acceptFriendRequest(requestId: string): Promise<Friendship> {
  const store = getStore();
  const requests = await store.getFriendRequests();
  const req = requests.find((r) => r.id === requestId);
  if (!req) throw new Error("Friend request not found");
  await store.saveFriendRequest({ ...req, status: "accepted" });
  const friendship: Friendship = {
    pairId: friendshipPairId(req.fromUid, req.toUid),
    uids: [req.fromUid, req.toUid],
    since: Date.now(),
  };
  await store.saveFriendship(friendship);
  return friendship;
}

/* ------------------------------------------------------------------ */
/* Kick & solo return (§10)                                            */
/* ------------------------------------------------------------------ */

async function returnToSolo(uid: string, displayName: string, bridgeEvents: string[]): Promise<string> {
  const store = getStore();
  const solo = await getOrCreateSoloRoom(uid, displayName);
  const character = solo.characters[solo.members[0]?.characterId ?? ""];
  const m = await ai();
  const bridge = await cloudText(
    m ? m.narrationPrompt(solo.room.sceneSummary, bridgeEvents, "Bridge this hero back into their solo campaign after leaving a party") : "",
    () => localBridge(character?.name ?? displayName, bridgeEvents),
  );
  await store.addLog(solo.room.code, {
    id: newId("log"), type: "narration", authorUid: null,
    text: bridge.text, route: bridge.route, dice: null, at: Date.now(),
  });
  return solo.room.code;
}

export interface KickResult {
  soloCode: string;
  snapshot: RoomSnapshot | null;
}

async function performKick(
  code: string,
  targetUid: string,
  byUid: string,
  type: "host" | "vote",
  reason: KickRecord["reason"],
): Promise<KickResult> {
  const store = getStore();
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error("Room not found");
  const target = snap.members.find((m) => m.uid === targetUid && m.status === "active");
  if (!target) throw new Error("That player is not in the room");
  await store.saveMember(code, { ...target, status: "kicked" });
  // If the boss player is removed mid-encounter, the boss reverts to the GM.
  const encounter = snap.encounters.find((e) => e.status === "active");
  if (encounter && encounter.boss.controlledByUid === targetUid) {
    await store.saveEncounter(code, { ...encounter, boss: { ...encounter.boss, controlledByUid: null } });
  }
  await store.addKickRecord({
    id: newId("kick"), roomCode: code, targetUid, byUid, type, reason, at: Date.now(),
  });
  await store.addLog(code, {
    id: newId("log"), type: "system", authorUid: null,
    text: `${target.displayName} was removed from the room.`, route: null, dice: null, at: Date.now(),
  });
  if (snap.room.currentTurnUid === targetUid) {
    const remaining = snap.members.filter((m) => m.status === "active" && m.uid !== targetUid);
    await store.saveRoom({
      ...snap.room, currentTurnUid: remaining[0]?.uid ?? snap.room.hostUid, updatedAt: Date.now(),
    });
  }
  const lastEvents = snap.log.slice(-3).map((e) => e.text);
  const soloCode = await returnToSolo(targetUid, target.displayName, lastEvents);
  return { soloCode, snapshot: await getRoomSnapshot(code) };
}

/** Host kick — immediate, host only (§10). Kicked player lands in solo. */
export async function kickMember(
  code: string,
  actorUid: string,
  targetUid: string,
  reason: KickRecord["reason"] = "other",
): Promise<KickResult> {
  code = code.toUpperCase();
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error("Room not found");
  if (snap.room.hostUid !== actorUid) throw new Error("Only the host can kick");
  if (actorUid === targetUid) throw new Error("The host cannot kick themselves");
  return performKick(code, targetUid, actorUid, "host", reason);
}

/** Voluntary leave — identical solo-return path, minus the kick record. */
export async function leaveRoomToSolo(code: string, uid: string): Promise<{ soloCode: string }> {
  const store = getStore();
  code = code.toUpperCase();
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error("Room not found");
  const member = snap.members.find((m) => m.uid === uid && m.status === "active");
  if (!member) throw new Error("You are not in this room");
  await store.saveMember(code, { ...member, status: "left" });
  await store.addLog(code, {
    id: newId("log"), type: "system", authorUid: null,
    text: `${member.displayName} left to continue solo.`, route: null, dice: null, at: Date.now(),
  });
  const lastEvents = snap.log.slice(-3).map((e) => e.text);
  const soloCode = await returnToSolo(uid, member.displayName, lastEvents);
  return { soloCode };
}

export interface VoteKickResult {
  vote: KickVote;
  kicked: boolean;
  soloCode: string | null;
}

async function tryResolveVote(code: string, vote: KickVote): Promise<VoteKickResult> {
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error("Room not found");
  const remaining = snap.members.filter((m) => m.status === "active" && m.uid !== vote.targetUid);
  const yes = remaining.filter((m) => vote.votes[m.uid]).length;
  if (!vote.resolved && vote.expiresAt > Date.now() && yes > remaining.length / 2) {
    const resolved: KickVote = { ...vote, resolved: true };
    await getStore().saveKickVote(code, resolved);
    const kicked = await performKick(code, vote.targetUid, vote.initiatedBy, "vote", "other");
    return { vote: resolved, kicked: true, soloCode: kicked.soloCode };
  }
  return { vote, kicked: false, soloCode: null };
}

/** Start a vote-kick (§10). The initiator's vote counts immediately. */
export async function startVoteKick(code: string, initiatorUid: string, targetUid: string): Promise<VoteKickResult> {
  code = code.toUpperCase();
  const vote: KickVote = {
    id: newId("vote"), targetUid, initiatedBy: initiatorUid,
    votes: { [initiatorUid]: true }, expiresAt: Date.now() + 60_000, resolved: false,
  };
  await getStore().saveKickVote(code, vote);
  return tryResolveVote(code, vote);
}

export async function castVoteKick(code: string, voteId: string, uid: string, approve: boolean): Promise<VoteKickResult> {
  code = code.toUpperCase();
  const store = getStore();
  const votes = await store.getKickVotes(code);
  const vote = votes.find((v) => v.id === voteId);
  if (!vote) throw new Error("Vote not found");
  const updated: KickVote = { ...vote, votes: { ...vote.votes, [uid]: approve } };
  await store.saveKickVote(code, updated);
  return tryResolveVote(code, updated);
}

/** Host-only room policy update (§6.1). */
export async function updateRoomPolicy(code: string, actorUid: string, policy: DropInPolicy): Promise<void> {
  const store = getStore();
  code = code.toUpperCase();
  const room = await store.getRoom(code);
  if (!room) throw new Error("Room not found");
  if (room.hostUid !== actorUid) throw new Error("Only the host can change room settings");
  await store.saveRoom({ ...room, dropInPolicy: policy, updatedAt: Date.now() });
}
