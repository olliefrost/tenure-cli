import Conf from "conf";
import type { StoredProfile, StyleProfile } from "./types.ts";

// Schema for values persisted by `conf`.
// Keeping this typed prevents ad-hoc key/value drift.
interface TenureStoreSchema {
  profileData?: StoredProfile;
}

// Lazily initialised singleton store instance.
// Lazy construction avoids filesystem side effects at module import time.
let storeInstance: Conf<TenureStoreSchema> | undefined;

function getStore(): Conf<TenureStoreSchema> {
  if (!storeInstance) {
    // `projectName` determines where config is stored in user config dirs.
    storeInstance = new Conf<TenureStoreSchema>({
      projectName: "tenure"
    });
  }

  return storeInstance;
}

export function saveProfile(profile: StyleProfile, model: string): StoredProfile {
  const store = getStore();
  const existing = store.get("profileData");
  const now = new Date().toISOString();

  // Preserve initial creation time across updates, but always refresh updatedAt.
  const payload: StoredProfile = {
    profile,
    model,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  store.set("profileData", payload);
  return payload;
}

export function loadProfile(): StoredProfile {
  const store = getStore();
  const profileData = store.get("profileData");
  if (!profileData) {
    // Friendly guidance for the common first-run scenario.
    throw new Error(
      "No style profile found. Run `tenure init <paths...>` before rewrite."
    );
  }

  return profileData;
}
