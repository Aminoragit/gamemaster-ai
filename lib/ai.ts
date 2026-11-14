/**
 * Hybrid AI generation — the technical core of GameMaster AI.
 *
 * Two entry points, mirroring BUILD_SPEC.md §2:
 *  - `generateHybrid` — Firebase AI Logic hybrid model with
 *    `InferenceMode.PREFER_ON_DEVICE`: Gemini Nano (Chrome built-in AI)
 *    answers first; the SDK falls back to cloud Gemini when on-device
 *    inference is unavailable. Used for NPC one-liners, boss taunts and
 *    scene summaries — short, latency-sensitive text.
 *  - `generateCloud` — `InferenceMode.ONLY_IN_CLOUD`: main scene
 *    narration, dice adjudication and drop-in entrance staging.
 *
 * Both return the route that actually served the request, read from the
 * SDK response's `inferenceSource`, so the UI can badge every block
 * (⚡ On-device / ☁ Cloud) with evidence, not a guess.
 *
 * When Firebase is not configured (scaffold/dev without keys), a clearly
 * marked stub is returned so the app still runs end-to-end. Stubs must
 * never be present in the submission build.
 */

import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
} from "firebase/ai";
import { firebaseReady, getFirebaseApp } from "./firebase";
import type { Route } from "./types";

export interface AiResult {
  text: string;
  route: Route;
  /** True when the local unconfigured stub produced this text. */
  stub: boolean;
}

const CLOUD_MODEL = "gemini-2.5-flash";

let hybridModel: GenerativeModel | null = null;
let cloudModel: GenerativeModel | null = null;

function models(): { hybrid: GenerativeModel; cloud: GenerativeModel } | null {
  const app = getFirebaseApp();
  if (!app || !firebaseReady) return null;
  if (!hybridModel || !cloudModel) {
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    hybridModel = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      onDeviceParams: {},
      inCloudParams: { model: CLOUD_MODEL },
    });
    cloudModel = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: { model: CLOUD_MODEL },
    });
  }
  return { hybrid: hybridModel, cloud: cloudModel };
}

async function run(model: GenerativeModel, prompt: string, fallbackRoute: Route): Promise<AiResult> {
  const result = await model.generateContent(prompt);
  const source = result.response.inferenceSource;
  return {
    text: result.response.text(),
    route:
      source === InferenceSource.ON_DEVICE
        ? "on_device"
        : source === InferenceSource.IN_CLOUD
          ? "in_cloud"
          : fallbackRoute,
    stub: false,
  };
}

const stub = (route: Route, kind: string): AiResult => ({
  text: `[dev stub — ${kind}] Configure Firebase in .env.local to get live ${route === "on_device" ? "hybrid" : "cloud"} generation.`,
  route,
  stub: true,
});

/** Short, latency-sensitive generation — on-device first, cloud fallback. */
export async function generateHybrid(prompt: string): Promise<AiResult> {
  const m = models();
  if (!m) return stub("on_device", "hybrid");
  try {
    return await run(m.hybrid, prompt, "on_device");
  } catch {
    // On-device unavailable and SDK fallback failed — go straight to cloud.
    return run(m.cloud, prompt, "in_cloud");
  }
}

/** Heavy narrative generation — cloud only. */
export async function generateCloud(prompt: string): Promise<AiResult> {
  const m = models();
  if (!m) return stub("in_cloud", "cloud");
  return run(m.cloud, prompt, "in_cloud");
}

/* ------------------------------------------------------------------ */
/* Prompt builders (contracts per BUILD_SPEC.md §4, §8)                */
/* ------------------------------------------------------------------ */

const GM_VOICE =
  "You are the game master of a tabletop RPG. Write in vivid present tense, " +
  "2–4 short paragraphs, end with a hook or a question to the players. " +
  "Never mention dice mechanics beyond what you are given.";

export function narrationPrompt(sceneSummary: string, recentLog: string[], action: string): string {
  return [
    GM_VOICE,
    `Story so far: ${sceneSummary}`,
    `Recent events:\n${recentLog.join("\n")}`,
    `The acting player attempts: ${action}`,
    "Narrate the opening of the next beat.",
  ].join("\n\n");
}

export function adjudicationPrompt(
  sceneSummary: string,
  action: string,
  dice: { total: number; dc: number; outcome: string },
): string {
  return [
    GM_VOICE,
    `Story so far: ${sceneSummary}`,
    `Action attempted: ${action}`,
    `Dice result (fixed, do not change): rolled ${dice.total} vs DC ${dice.dc} — ${dice.outcome}.`,
    "Narrate the consequence of exactly this outcome, then present the next beat.",
  ].join("\n\n");
}

export function npcLinePrompt(npcName: string, situation: string): string {
  return (
    `You are ${npcName} in a tabletop RPG scene. Situation: ${situation}. ` +
    "Reply with ONE short in-character line of dialogue, no narration."
  );
}

export function sceneSummaryPrompt(previousSummary: string, newEvents: string[]): string {
  return [
    "Compress this tabletop RPG session into a briefing of at most 80 words.",
    `Previous summary: ${previousSummary || "(start of session)"}`,
    `New events:\n${newEvents.join("\n")}`,
    "Return only the updated summary.",
  ].join("\n\n");
}

/** §8.1 — the entrance staging contract for ally and boss drop-ins. */
export function entrancePrompt(input: {
  form: "ally" | "boss";
  sceneSummary: string;
  recentLog: string[];
  partyRoster: string[];
  entrantName: string;
  entrantDetail: string;
}): string {
  const who =
    input.form === "ally"
      ? `A new ally arrives: ${input.entrantName} (${input.entrantDetail}). Give them a causal reason to be here and one suggested first action.`
      : `The encounter's true threat reveals itself — a boss enters play: ${input.entrantName} (${input.entrantDetail}). Recontextualise the scene around this reveal.`;
  return [
    GM_VOICE,
    `Story so far: ${input.sceneSummary}`,
    `Recent events:\n${input.recentLog.join("\n")}`,
    `Party present: ${input.partyRoster.join(", ")}`,
    who,
    "Write ONLY the entrance narration (2–4 sentences). This text is how the whole table learns what just happened.",
  ].join("\n\n");
}
