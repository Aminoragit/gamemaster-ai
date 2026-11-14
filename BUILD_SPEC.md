# GameMaster AI — Build Spec

**Event:** #BuildHybridAI 2026 (Devpost) · **Deadline:** 2026-12-01 07:00 KST
**Format:** Solo developer · Web (Chrome) · English UI · Free tier only (Spark plan, no billing, no paid APIs — hard rule)
**Stack:** Next.js (App Router) + TypeScript + Tailwind CSS · Firebase (Auth, Firestore, AI Logic, App Check)

---

## 1. Concept

GameMaster AI is a multiplayer tabletop RPG where the game master is an AI.
A host creates a room and shares a 6-character room code; 2–4 players join from
their own browsers. The AI GM narrates scenes, voices NPCs, calls for dice
checks, and adjudicates outcomes. The same character sheet carries across
**solo play** and **multiplayer rooms**, and players can **drop into public
games already in progress** — either as a new party ally, or, when the moment
is right, as the **active boss** of the current encounter, played live against
the party.

The product's core technical claim — and its judging hook — is **hybrid
inference made visible**: light, latency-sensitive generation runs on-device
(Gemini Nano via Firebase AI Logic hybrid mode), heavy narrative generation
runs on cloud Gemini, and every generated block in the UI carries a badge
showing which route produced it.

### Judging map (each criterion 1–5)

| Criterion | How this project answers it |
|---|---|
| Technical implementation | Real Firebase AI Logic hybrid calls (`InferenceMode.PREFER_ON_DEVICE` with cloud fallback + `ONLY_IN_CLOUD` for heavy scenes), Firestore real-time sync, App Check, deterministic dice engine with unit tests, situation-weighted drop-in role engine |
| Design | Route badges make the hybrid architecture legible at a glance; boss-control UI is a distinct mode; entrance staging turns a join event into a story beat |
| Potential impact | Lowers the barrier to tabletop RPGs (no human GM needed, no scheduling — drop-in replaces session planning); solo↔multi continuity keeps characters alive between group sessions |
| Idea quality | Drop-in as an *active boss* is a novel social mechanic; the weighted role roll is revealed in-fiction by the GM |

---

## 2. Hybrid architecture

```
┌──────────────────────────── Browser (Chrome) ────────────────────────────┐
│                                                                          │
│  Next.js app                                                             │
│   ├─ lib/ai.ts ──► Firebase AI Logic (firebase/ai)                       │
│   │                 ├─ Hybrid model: mode = PREFER_ON_DEVICE             │
│   │                 │    ├─ on-device: Gemini Nano (Chrome built-in AI)  │
│   │                 │    └─ fallback:  cloud Gemini (inCloudParams)      │
│   │                 └─ Cloud model:  mode = ONLY_IN_CLOUD                │
│   │                      (scene narration, adjudication, boss staging)   │
│   ├─ App Check (ReCaptchaEnterpriseProvider / debug token in dev)        │
│   ├─ Firebase Auth (anonymous)                                           │
│   └─ Firestore client (rooms, log, players, friends — onSnapshot sync)   │
│                                                                          │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTPS + App Check token
                        ┌──────────▼───────────┐
                        │  Firebase (Spark)    │
                        │  Firestore · Auth    │
                        │  AI Logic → Gemini   │
                        │  Developer API       │
                        │  (free tier)         │
                        └──────────────────────┘
```

Route decision rule (`lib/ai.ts`):

| Call type | Route | Why |
|---|---|---|
| NPC one-liners, quick reactions | Hybrid, `PREFER_ON_DEVICE` | Latency-critical, short output; Nano is good enough, cloud fallback keeps it working everywhere |
| Scene recap / drop-in briefing refresh | Hybrid, `PREFER_ON_DEVICE` | Summarisation is a Nano strength; keeps the lobby snappy |
| Main scene narration after a party action | Cloud only | Long-form coherence, needs the big model |
| Dice-check adjudication narration | Cloud only | Must stay consistent with game state and tone |
| Drop-in entrance staging (ally & boss) | Cloud only | Highest-visibility moment of the feature; quality matters |
| Boss taunts during a boss-controlled encounter | Hybrid, `PREFER_ON_DEVICE` | Frequent, short, latency-sensitive |

Every AI call returns `{ text, route }` where `route` is read from the SDK
response's `inferenceSource` (`on_device` / `in_cloud`) when available.
The game screen renders a badge per entry: **⚡ On-device (Gemini Nano)** or
**☁ Cloud (Gemini)**. If Firebase is not configured (no env vars), `lib/ai.ts`
returns a clearly-marked local stub so the app still builds and runs for
development — stubs are never shipped in the submission build.

App Check: initialised in `lib/appcheck.ts` before any AI/Firestore call.
Production uses `ReCaptchaEnterpriseProvider` (site key via env var);
local development uses the debug token flow
(`self.FIREBASE_APPCHECK_DEBUG_TOKEN`) as explicitly allowed by the rules.

---

## 3. Screens & routes

| Route | Purpose |
|---|---|
| `/` | Home: display name entry, **Create Room**, **Join with code**, **Continue Solo**, link to Lobby / Friends / Settings |
| `/lobby` | Public room browser. Lists only rooms the *effective drop-in rule* (§6) says this user may enter; each card shows party size, scene phase, drop-in policy icons (ally / boss possible) |
| `/room?code=XXXXXX` | Game screen: scene log (with route badges), action input + suggested actions, dice tray, member panel (friend-add, host kick, vote-kick), room settings panel (host), boss control panel (when a boss encounter is player-controlled). The code is a query parameter, not a path segment — the static export has no dynamic routes (see §12) |
| `/solo` | Solo campaign screen — same game UI, single player, same character sheet |
| `/friends` | Friend list, pending requests, friends' open rooms, invite inbox |
| `/settings` | Personal settings: drop-in preferences (§6.2), presence visibility, boss-role opt-in |

Game screen layout (desktop; stacks on mobile):

```
┌──────────────────────────────────────────────┬───────────────┐
│ Scene log (narration, actions, dice results) │ Party panel   │
│  [☁ Cloud] GM: The gate groans open…         │  • Host ★     │
│  [⚡ Device] NPC: "State your business!"     │  • Player 2   │
│  🎲 Mira rolls Stealth 14 vs DC 12 — Success │  • Player 3   │
├──────────────────────────────────────────────┤  [+ Friend]   │
│ > What do you do?  [input............] [Go]  │  [Kick ▾]     │
│ Suggestions: [Hide] [Bribe the guard] [Run]  ├───────────────┤
└──────────────────────────────────────────────┴───────────────┤
                                       Boss panel (boss encounters only)
```

---

## 4. Core game loop

1. **Room creation** — host picks a scenario seed (title, genre, tone) and
   room settings (§6.1). Cloud GM generates the opening scene → written to
   `rooms/{code}/log`.
2. **Player turn** — the current player picks a suggested action or types a
   free-form action. Actions are written to the log as `pending`.
3. **Dice check** — the client-side dice engine (`lib/dice.ts`) rolls
   d20 + modifier against a DC set by the GM prompt contract; the roll is
   deterministic-recorded in the log (dice, modifier, total, outcome tier:
   critical success / success / failure / critical failure).
4. **Adjudication** — cloud GM receives: scene summary, recent log window,
   the action, and the dice outcome; it narrates the result and the next
   beat, and may trigger an NPC line (on-device hybrid call).
5. **Turn rotation** — `rooms.currentTurnUid` advances; Firestore snapshots
   push the new state to every client. Boss encounters use the encounter
   turn order instead (§7).
6. **Scene summary maintenance** — after each cloud narration, a hybrid
   on-device-preferred call refreshes `rooms.sceneSummary` (used for
   drop-in briefings and to keep GM context bounded).

Solo mode runs the identical loop with a one-member room
(`rooms.mode = "solo"`, not listed in the lobby).

---

## 5. Characters — one sheet, every mode

`characters/{characterId}` is owned by a user and is the *same document*
whether the character is in a solo thread, a party room, or a boss's
campaign. It holds name, class, level, HP, stats, inventory, XP, and a
`campaignLog` of one-line milestones. Mode transitions (solo → drop-in →
kicked → solo) never copy the sheet; rooms only reference `characterId`.
This is what makes "leave with your character, lose nothing" true by
construction rather than by an export step.

---

## 6. Drop-in — bilateral policy

Drop-in eligibility is the **conjunction of room policy and personal
settings**. Neither side alone can force a drop-in.

### 6.1 Room settings (host side) — `rooms.dropInPolicy`

| Field | Values | Notes |
|---|---|---|
| `mode` | `anyone` / `friends` / `invite` / `off` | Who may drop in at all |
| `bossAllowed` | boolean | Whether an active-boss drop-in may occur in this room |
| `maxPlayers` | 2–4 (party cap, boss excluded) | Drop-in closes at cap |
| `windows` | `exploration` / `combat` / `bossEncounter` booleans + `pauseDuringResolution: true` | No drop-in lands while a dice resolution / GM narration is in flight; combat drop-in can be disabled independently of exploration |

Room also carries `visibility: "public" | "private"` — only public rooms
appear in the lobby; private rooms are code/invite only.

### 6.2 Personal settings (solo player side) — `users/{uid}.settings.dropIn`

| Field | Values | Notes |
|---|---|---|
| `enabled` | boolean | Master switch for using drop-in at all |
| `scope` | `any` / `friendsOnly` | Restricts which rooms the lobby will offer |
| `showPresence` | boolean | Whether friends can see "looking for a game" presence |
| `acceptBossRole` | boolean | Whether this player may be assigned the boss role |

### 6.3 Effective rule (`lib/dropin.ts` — `canDropIn`)

A room is offered to a user **iff all** hold:

1. `user.settings.dropIn.enabled = true`
2. `room.visibility = "public"` and `room.dropInPolicy.mode ≠ off`
3. `mode = anyone`, or (`mode = friends` and a friend edge exists with any
   current member), or (`mode = invite` and an invite doc exists)
4. `user scope = any`, or (`scope = friendsOnly` and condition 3 was met
   via friendship)
5. Party size < `maxPlayers` (for ally drops) and the current scene phase
   is an open window, and no resolution is in flight

The lobby query fetches public rooms, then applies `canDropIn` client-side
(Firestore rules mirror the same checks for writes). Friend invitations and
friend-room surfacing always follow the *invitee's* personal scope: if a
user's scope is `friendsOnly` and presence is hidden, they simply never
appear as "available" and receive invites only from friends.

---

## 7. Drop-in forms — ally or active boss (situation-weighted)

When an eligible drop-in is initiated, `lib/dropin.ts` —
`rollDropInRole` — decides the entrant's form by **situation-weighted
random**, never flat random:

### 7.1 Hard gates (checked before any roll)

Boss form is *impossible* unless **all** hold:
`room.dropInPolicy.bossAllowed = true` AND
`user.settings.dropIn.acceptBossRole = true` AND the room is in, or about
to enter, a boss encounter AND no player-controlled boss is active.
If any gate fails → ally form, no roll.

### 7.2 Weights

Base: ally 70 / boss 30, adjusted by situation:

| Factor | Ally Δ | Boss Δ |
|---|---|---|
| Scene phase = boss encounter imminent/active | −30 | +30 |
| Scene phase = early exploration (scene # ≤ 3) | +25 | −25 |
| Party size ≥ 3 | −10 | +10 |
| Party size = 1 (host alone) | +20 | −20 |
| A boss drop-in already happened this session | +30 | −30 |
| Boss encounter but party HP average < 40% | +15 | −15 (mercy rule) |

Weights are clamped to ≥ 5 so neither outcome is ever literally impossible
when the gates pass. Example outcomes:

| Situation | Ally | Boss |
|---|---|---|
| Early exploration, 2 players | 95% | 5% (gates usually closed anyway) |
| Boss encounter, 4 players, fresh session | 30% | 70% |
| Boss encounter, 2 players, boss drop already used | 60% | 40% |
| Mid exploration, 3 players, no boss nearby | 85% | 15% |

The roll result is **revealed in-fiction**: the GM narration announces the
entrance before the entrant's UI switches mode, so the table learns what
happened from the story, not from a system popup.

### 7.3 Ally form

The entrant joins the party with their existing character sheet (§5). The
GM staging call (§8) writes an entrance scene. The entrant receives the
scene briefing (§8.2) before their first turn.

### 7.4 Active boss form

The entrant temporarily **controls the encounter boss**:

- **Boss sheet** (`encounters/{id}.boss`): name, title, HP, armour,
  3 abilities + 1 signature move (cooldown), a menace meter that fills as
  the party lands hits (unlocks the signature move).
- **Boss control UI** (in `/room?code=…`, replaces the normal action
  input on the boss player's turn): ability cards with targets, a taunt
  button (hybrid on-device NPC-line call in the boss's voice), and the
  boss's private objective card.
- **Win conditions (boss player)**: *Victory* — party wipe or the party
  fails its objective before the encounter timer (turn count) expires;
  *Defeat* — boss HP reaches 0. A draw (timer expires with both standing)
  counts as a boss partial victory ("the party was delayed").
- **Rewards**: boss player earns XP and a "Boss Slayer / Menace" badge on
  their profile scaled by outcome (win > draw > loss, loss still grants
  participation XP so dropping in as a boss is never a punishment); the
  party earns bonus loot on a win. All rewards write to the same
  character/profile documents.
- **After the encounter**: the boss player chooses — **return to solo**
  (default; their character sheet was never at risk, rewards banked) or
  **convert to ally** and continue with the party (only if the party is
  below `maxPlayers` and the room's drop-in mode still admits them). If
  they do nothing within 60 s, they return to solo automatically.

While boss-controlled, the encounter's GM narration continues on the cloud
route, but boss *actions* come from the player; the GM adjudicates boss
actions with the same dice engine (boss rolls are public).

---

## 8. Entrance staging & briefing (the "natural" in natural drop-in)

### 8.1 GM entrance staging — cloud call

On any drop-in, before the entrant can act, a cloud GM call generates the
entrance. Prompt contract (inputs → output):

- Inputs: `sceneSummary`, last 5 log entries, party roster (names/classes),
  entrant character (name/class/one-line backstory) **or** boss sheet,
  drop-in form (ally/boss).
- Output: 2–4 sentences of in-world narration that *causally* introduces
  the newcomer (an ally arrives with a reason to be there; a boss reveal
  recontextualises the scene — "the 'statue' opens its eyes"), plus one
  suggested first action for an ally entrant.
- The narration is appended to the log with type `entrance`, route badge
  ☁ Cloud, and the entrant's client unlocks input only after it lands.

### 8.2 Scene briefing for the entrant

- The room maintains `rooms.sceneSummary` (§4.6), refreshed by the hybrid
  on-device-preferred summariser after each scene change — so a briefing
  is *already there* when someone drops in, at zero extra cloud cost.
- On drop-in, the entrant's client shows a briefing card: scene summary +
  "previously on" (last 3 milestones) + party roster. If the summary is
  stale (> 2 scenes old), the entrant's own client refreshes it with a
  hybrid call before showing it.
- Boss entrants additionally receive the party's public status (HP bands,
  not exact numbers) and their objective card — never the party's private
  notes.

---

## 9. Friends

- **Add from the room**: member panel → "Add friend" sends
  `friendRequests/{id}` (from, to, status). Also add by display name from
  `/friends`.
- **Model**: accepted friendships are stored as a single
  `friendships/{pairId}` doc (`pairId` = sorted uid pair) with both uids
  denormalised for queries.
- **Friend rooms**: `/friends` and the lobby prioritise rooms containing
  friends (subject to §6.3 — the friend's own settings still govern what
  they see, and presence requires `showPresence`).
- **Invites**: `invites/{id}` (roomCode, from, to, status, expiresAt).
  Accepting an invite performs the §6.3 check with `mode = invite`
  satisfied, then runs the normal drop-in flow (§7–8).

---

## 10. Kick & solo return

- **Host kick**: host only, from the member panel, with a reason select
  (idle / disruption / other). Immediate.
- **Vote kick (option, specced)**: any member may start a vote; removal
  needs a majority of *remaining* members within 60 s. The host can be
  vote-kicked only if they have been idle > 10 min (host then passes to
  the longest-present member). Vote state lives in
  `rooms/{code}/kickVotes/{id}`.
- **Every kick writes** `kickRecords/{id}` (room, target, by/initiator,
  type: host|vote, reason, at) — kept for abuse review and to enforce the
  rejoin rule: a kicked player cannot rejoin that room for 24 h unless
  invited by the host.
- **Solo return (no progress loss)**: because the character sheet is a
  standalone document (§5), the kicked player's client simply: marks their
  room membership `kicked`, spawns/locates their **solo thread** room
  (`mode = "solo"`), seeds it with a cloud GM "meanwhile…" bridge
  narration that picks the character up where the party scene left them
  (input: their last 3 log entries in the room), and drops them into
  `/solo` with a notice card. HP/XP/inventory are already current — the
  sheet was being updated live all along. Voluntary "Leave to solo" uses
  the identical path minus the kick record.

---

## 11. Firestore data model

```
users/{uid}
  displayName, createdAt
  settings: {
    dropIn: { enabled, scope: "any"|"friendsOnly",
              showPresence, acceptBossRole }
  }
  badges: [ "boss_win", ... ]

characters/{characterId}
  ownerUid, name, class, level, xp, hp, maxHp,
  stats: { str, dex, int, cha }, inventory: [string],
  campaignLog: [ { at, text } ], updatedAt

rooms/{roomCode}                      // roomCode = 6-char join code
  hostUid, title, genre, tone, mode: "party"|"solo",
  visibility: "public"|"private",
  status: "lobby"|"playing"|"finished",
  dropInPolicy: { mode: "anyone"|"friends"|"invite"|"off",
                  bossAllowed, maxPlayers,
                  windows: { exploration, combat, bossEncounter },
                  pauseDuringResolution: true },
  sceneSummary, sceneIndex, currentTurnUid,
  activeEncounterId: string|null,
  createdAt, updatedAt

rooms/{roomCode}/members/{uid}
  role: "host"|"player"|"boss", characterId,
  joinedVia: "create"|"code"|"dropin"|"invite",
  status: "active"|"left"|"kicked", joinedAt

rooms/{roomCode}/log/{entryId}
  type: "narration"|"action"|"dice"|"npc"|"entrance"|"system",
  authorUid|null, text, route: "on_device"|"in_cloud"|null,
  dice: { expr, rolls:[], modifier, total, dc, outcome }|null, at

rooms/{roomCode}/encounters/{encounterId}
  kind: "boss", status: "active"|"won"|"lost"|"draw",
  boss: { name, title, hp, maxHp, controlledByUid|null,
          abilities: [{ id, name, desc, cooldown }],
          signatureMove: {...}, menace: 0..100 },
  turnOrder: [uid...], turnIndex, turnsLeft, startedAt, endedAt

rooms/{roomCode}/kickVotes/{voteId}
  targetUid, initiatedBy, votes: { uid: bool }, expiresAt, resolved

dropInEvents/{eventId}
  roomCode, uid, form: "ally"|"boss",
  weights: { ally, boss }, factors: [string], rolledAt

friendRequests/{id}   { fromUid, toUid, status, at }
friendships/{pairId}  { uids: [a, b], since }
invites/{id}          { roomCode, fromUid, toUid, status, expiresAt }
kickRecords/{id}      { roomCode, targetUid, byUid, type, reason, at }
```

Security rules (to write in implementation phase): members-only read/write
on room subcollections, host-only writes to `dropInPolicy` and kick
actions, users write only their own `settings`, friendship writes require
an accepted request. App Check enforcement on Firestore + AI Logic.

---

## 12. Free-tier operation (Spark plan, ₩0)

- Gemini Developer API free tier via Firebase AI Logic — no billing
  account attached, ever. On-device Nano inference is free and unmetered.
- Firestore Spark limits (50k reads / 20k writes per day) are ample for a
  judged demo: log writes are batched per turn, summaries cached in the
  room doc instead of recomputed.
- Hosting: **Firebase Hosting (Spark) with a static export**
  (`output: 'export'` in `next.config.ts`, `firebase.json` →
  `public: "out"`, SPA fallback rewrite). No Cloud Functions (they would
  require Blaze) — all logic is client-side by design, which is also why
  dice/drop-in engines are pure, unit-tested modules. Consequences of
  the export: Next 16's Cache Components/PPR are off (rejected in export
  mode, and unused here), and there are no dynamic segments —
  `/room/[code]` became `/room?code=XXXXXX`, read client-side via
  `useSearchParams`.
- Hosting (mirror): **GitHub Pages via GitHub Actions**
  (`.github/workflows/deploy-pages.yml`). Every push to `main` checks
  out the repo, builds the same static export with Node 20
  (`npm ci` → `npm run build`), uploads `out/` with
  `upload-pages-artifact`, and publishes it with `deploy-pages`
  (workflow permissions: `contents: read`, `pages: write`,
  `id-token: write`). The site is a Pages *project* site,
  https://aminoragit.github.io/gamemaster-ai/, so the CI build sets
  `NEXT_PUBLIC_BASE_PATH=/gamemaster-ai`; `next.config.ts` reads that
  variable and applies it as `basePath` + `assetPrefix` (routes, links,
  icon, and `/_next` assets all get the prefix). With the variable
  unset — local builds and the Firebase Hosting build at the domain
  root — the config is unchanged and no prefix is applied. Because
  basePath is inlined at build time, each target is built separately.
  The workflow also carries the Firebase web config and the App Check
  site key as plain `env` values: they are public client identifiers
  embedded in the bundle served to every browser (access control lives
  in Firestore rules + App Check), so they are not kept as GitHub
  Secrets — the workflow file documents this inline.
- The Sprint quota accounts for paid models are **not** used: a quota
  overrun could bill the personal account, which the project's cost rule
  forbids. Free-tier models only.

---

## 13. Milestones (back-planned from 2026-12-01 07:00 KST)

| Date | Milestone |
|---|---|
| 11/14–15 | **User step:** create Firebase project (Spark), enable Auth (anonymous), Firestore, AI Logic, App Check; paste web config + reCAPTCHA site key into `.env.local` (see §14). Scaffold (this deliverable) already builds without keys |
| 11/20 | **Core loop**: create/join room, cloud narration + hybrid NPC lines with route badges, dice engine wired, solo mode on the shared character sheet |
| 11/25 | **Multiplayer & social**: real-time sync polish, public lobby with bilateral drop-in filtering, entrance staging + briefing, ally/boss weighted roll, boss control UI + encounter lifecycle, friends + invites, host/vote kick with solo return |
| 11/28 | **Feature freeze**: demo scenario scripted and rehearsed end-to-end (incl. one ally drop-in and one boss drop-in on camera), demo video final cut (≤ 3 min, English subtitles) |
| 11/30 | **Submission**: public GitHub repo + MIT licence in About, Devpost form (description incl. hybrid summary + change summary n/a), video public on YouTube |
| 12/01 07:00 | Deadline (buffer: everything submitted the day before) |

---

## 14. Steps only the user can do

1. Create the Firebase project under their own Google account and enable:
   Anonymous Auth, Firestore (production mode), Firebase AI Logic
   (Gemini Developer API), App Check with reCAPTCHA Enterprise.
2. Provide the web app config + App Check site key (into `.env.local`,
   never committed).
3. At submission time: create the **public** GitHub repository (personal
   account only) and the YouTube upload — both are account actions.

Until step 1–2 are done, development proceeds against the stub route in
`lib/ai.ts`; no placeholder keys are invented.

---

## 15. Scaffold contents (this deliverable)

- `lib/firebase.ts` — env-based init, build-safe when unconfigured
- `lib/appcheck.ts` — App Check init incl. debug-token dev flow
- `lib/ai.ts` — hybrid generation: `generateHybrid` (PREFER_ON_DEVICE with
  cloud fallback) and `generateCloud` (ONLY_IN_CLOUD), route reporting,
  stub fallback when unconfigured; prompt builders for narration,
  adjudication, entrance staging
- `lib/dice.ts` + tests — d20 checks, outcome tiers
- `lib/dropin.ts` + tests — `canDropIn` bilateral rule, `rollDropInRole`
  situation weights
- `lib/types.ts` — the Firestore model of §11 as TypeScript types
- Routes: `/`, `/lobby`, `/room?code=…`, `/solo`, `/friends`, `/settings`
- Components: `RouteBadge`, `MemberPanel` (friend-add / kick),
  `BossControls`, `RoomSettingsPanel`, `DropInSettingsForm`, `FirebaseInit`
- `.env.example`, `npm test` (vitest), production build verified
