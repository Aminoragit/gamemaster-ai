# GameMaster AI

**An AI Game Master for multiplayer tabletop RPG — built with Firebase AI Logic.**
Entry for **#BuildHybridAI 2026** (Firebase AI Logic Hybrid Hackathon), Web platform.

One shared character sheet. Play solo for as long as you like — then drop into a
public party room mid-game, or have a party member drop into yours. The AI GM
narrates every entrance in-story, so nobody ever "teleports in".

## Highlights

- **Hybrid inference, visibly.** Narration runs through Firebase AI Logic with
  `PREFER_ON_DEVICE` (Gemini Nano in Chrome) and an automatic cloud fallback
  (Gemini Flash). Every GM message shows a route badge — ⚡ on-device or ☁ cloud —
  read from the actual response's `inferenceSource`.
- **Solo ⇄ multiplayer on one character.** The same character sheet powers the
  solo campaign and every room you join.
- **Two-sided drop-in consent.** A drop-in happens only when *both* the room's
  settings (anyone / friends / invite-only / closed, boss allowed or not) *and*
  the player's personal settings allow it. The lobby only lists rooms that pass
  both sides.
- **Weighted drop-in roles.** A drop-in is resolved as a companion join — or,
  when a boss encounter is live and both sides allow it, as a **boss intrusion**:
  the newcomer *plays the boss*, with its own sheet, signature move, menace
  meter and boss-only win conditions. Odds shift with the situation (boss fight
  +30 boss, early exploration +25 companion, a mercy rule when the party is
  nearly wiped).
- **Friends & kicks, handled in-fiction.** Add friends inside a room; a kicked
  player keeps their character and returns to their solo thread under a GM
  "Meanwhile…" bridge scene.
- **Real backend.** Anonymous Auth sign-in, Firestore-backed rooms, and App
  Check (reCAPTCHA Enterprise) in front of AI calls — all on the free Spark plan.

## Tech

- Next.js 16 (static export) · TypeScript · Tailwind CSS 4
- Firebase AI Logic (hybrid on-device/cloud) · Firestore · Anonymous Auth · App Check
- Hosted on GitHub Pages via GitHub Actions

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in your Firebase web config + reCAPTCHA site key
npm run dev
```

Without Firebase env vars the app runs in a self-contained demo mode
(in-memory store, scripted GM), so the full loop is explorable offline.

```bash
npm test        # unit tests (dice, drop-in policy, turn engine, store)
npm run build   # production static export
```

## Project layout

- `app/` — routes: home, lobby, room, solo, friends, settings
- `lib/ai.ts` — Firebase AI Logic hybrid routing + route badges
- `lib/game.ts` — store interface (Firestore in production, in-memory for demo)
- `lib/dropin.ts` — two-sided consent + weighted role roll (pure, tested)
- `lib/turn.ts` — turn engine: stat checks, dice tiers, boss encounter math
- `BUILD_SPEC.md` — full design spec, data model and policy tables

## License

MIT — see `LICENSE`.
