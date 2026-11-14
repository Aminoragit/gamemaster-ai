/**
 * Firebase initialisation — env-driven and build-safe.
 *
 * The app must build and render with NO Firebase project configured
 * (scaffold phase, CI, judges' first clone). When the env vars are
 * absent, `firebaseReady` is false and callers fall back to stubs.
 * Real values go in `.env.local` (see `.env.example`) — never committed.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseReady = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId,
);

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseReady) return null;
  if (app) return app;
  app = getApps().length ? getApp() : initializeApp(config);
  return app;
}

export function getFirebaseAuth(): Auth | null {
  const a = getFirebaseApp();
  return a ? getAuth(a) : null;
}

export function getDb(): Firestore | null {
  const a = getFirebaseApp();
  return a ? getFirestore(a) : null;
}
