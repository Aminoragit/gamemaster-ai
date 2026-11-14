"use client";

import { useEffect } from "react";
import { initAppCheck } from "@/lib/appcheck";

/** Mounts once at the root: initialises App Check before AI/Firestore use. */
export default function FirebaseInit() {
  useEffect(() => {
    initAppCheck();
  }, []);
  return null;
}
