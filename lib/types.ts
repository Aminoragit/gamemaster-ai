/**
 * Shared data model — mirrors BUILD_SPEC.md §11 (Firestore).
 * Rooms are keyed by their 6-character join code.
 */

export type Route = "on_device" | "in_cloud";

export type DropInMode = "anyone" | "friends" | "invite" | "off";
export type DropInScope = "any" | "friendsOnly";
export type ScenePhase = "exploration" | "combat" | "bossEncounter";
export type DropInForm = "ally" | "boss";
export type MemberRole = "host" | "player" | "boss";

export interface DropInSettings {
  /** Master switch for using drop-in at all. */
  enabled: boolean;
  /** Which rooms the lobby may offer this user. */
  scope: DropInScope;
  /** Whether friends can see "looking for a game" presence. */
  showPresence: boolean;
  /** Whether this player may be assigned the boss role on drop-in. */
  acceptBossRole: boolean;
}

export interface UserDoc {
  displayName: string;
  settings: { dropIn: DropInSettings };
  badges: string[];
  createdAt: number;
}

export interface CharacterSheet {
  id: string;
  ownerUid: string;
  name: string;
  className: string;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  stats: { str: number; dex: number; int: number; cha: number };
  inventory: string[];
  campaignLog: { at: number; text: string }[];
  updatedAt: number;
}

export interface DropInPolicy {
  mode: DropInMode;
  /** Whether an active-boss drop-in may occur in this room. */
  bossAllowed: boolean;
  /** Party cap (boss player excluded). 2–4. */
  maxPlayers: number;
  windows: { exploration: boolean; combat: boolean; bossEncounter: boolean };
  /** Never land a drop-in while a dice resolution / narration is in flight. */
  pauseDuringResolution: boolean;
}

export interface Room {
  code: string;
  hostUid: string;
  title: string;
  genre: string;
  tone: string;
  mode: "party" | "solo";
  visibility: "public" | "private";
  status: "lobby" | "playing" | "finished";
  dropInPolicy: DropInPolicy;
  sceneSummary: string;
  sceneIndex: number;
  currentPhase: ScenePhase;
  currentTurnUid: string | null;
  resolutionInFlight: boolean;
  activeEncounterId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RoomMember {
  uid: string;
  role: MemberRole;
  characterId: string;
  displayName: string;
  joinedVia: "create" | "code" | "dropin" | "invite";
  status: "active" | "left" | "kicked";
  joinedAt: number;
}

export interface DiceResult {
  expr: string;
  rolls: number[];
  modifier: number;
  total: number;
  dc: number;
  outcome: "critical_success" | "success" | "failure" | "critical_failure";
}

export interface LogEntry {
  id: string;
  type: "narration" | "action" | "dice" | "npc" | "entrance" | "system";
  authorUid: string | null;
  text: string;
  /** Which inference route produced this text (null for human/system entries). */
  route: Route | null;
  dice: DiceResult | null;
  at: number;
}

export interface BossAbility {
  id: string;
  name: string;
  description: string;
  cooldownTurns: number;
  cooldownLeft: number;
}

export interface BossSheet {
  name: string;
  title: string;
  hp: number;
  maxHp: number;
  controlledByUid: string | null;
  abilities: BossAbility[];
  signatureMove: BossAbility;
  /** 0–100; fills as the party lands hits; unlocks the signature move. */
  menace: number;
}

export interface Encounter {
  id: string;
  kind: "boss";
  status: "active" | "won" | "lost" | "draw";
  boss: BossSheet;
  turnOrder: string[];
  turnIndex: number;
  turnsLeft: number;
  startedAt: number;
  endedAt: number | null;
}

export interface DropInEvent {
  id: string;
  roomCode: string;
  uid: string;
  form: DropInForm;
  weights: { ally: number; boss: number };
  factors: string[];
  rolledAt: number;
}

export interface FriendRequest {
  id: string;
  fromUid: string;
  toUid: string;
  status: "pending" | "accepted" | "declined";
  at: number;
}

export interface Friendship {
  /** Document id: the two uids sorted and joined with "_". */
  pairId: string;
  uids: [string, string];
  since: number;
}

export interface Invite {
  id: string;
  roomCode: string;
  fromUid: string;
  toUid: string;
  status: "pending" | "accepted" | "declined" | "expired";
  expiresAt: number;
}

export interface KickRecord {
  id: string;
  roomCode: string;
  targetUid: string;
  byUid: string;
  type: "host" | "vote";
  reason: "idle" | "disruption" | "other";
  at: number;
}

export interface KickVote {
  id: string;
  targetUid: string;
  initiatedBy: string;
  votes: Record<string, boolean>;
  expiresAt: number;
  resolved: boolean;
}

export function friendshipPairId(a: string, b: string): string {
  return [a, b].sort().join("_");
}
