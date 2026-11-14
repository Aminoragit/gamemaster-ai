/**
 * App Check initialisation (BUILD_SPEC.md §2).
 *
 * Production: ReCaptchaEnterpriseProvider with the site key from
 * NEXT_PUBLIC_RECAPTCHA_SITE_KEY. Local development uses the App Check
 * debug token flow, which the hackathon rules explicitly allow at
 * submission time. Call `initAppCheck()` once, client-side, before any
 * AI Logic or Firestore call (see components/FirebaseInit).
 */

import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import { getFirebaseApp } from "./firebase";

declare global {
  interface Window {
    FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
  }
}

let appCheck: AppCheck | null = null;
let attempted = false;

export function initAppCheck(): AppCheck | null {
  if (typeof window === "undefined") return null;
  if (appCheck || attempted) return appCheck;
  attempted = true;

  const app = getFirebaseApp();
  if (!app) return null;

  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (process.env.NODE_ENV !== "production") {
    // Debug-token flow: Firebase prints a debug token to the console;
    // register it in Firebase Console → App Check → Manage debug tokens.
    window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  if (!siteKey && process.env.NODE_ENV === "production") {
    console.warn("[appcheck] NEXT_PUBLIC_RECAPTCHA_SITE_KEY missing — App Check not initialised.");
    return null;
  }

  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey ?? "debug"),
    isTokenAutoRefreshEnabled: true,
  });
  return appCheck;
}
