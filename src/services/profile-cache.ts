import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { ProfileResponse } from "../api/schemas.js";

const CACHE_PATH = "data/profile-cache.json";

export async function readProfileCache(): Promise<Record<string, ProfileResponse>> {
  try {
    const raw = await readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, ProfileResponse>;
  } catch {
    return {};
  }
}

export async function writeProfileCacheEntry(
  publicIdentifier: string,
  profile: ProfileResponse,
): Promise<void> {
  const all = await readProfileCache();
  all[publicIdentifier.toLowerCase()] = profile;
  await mkdir("data", { recursive: true });
  await writeFile(CACHE_PATH, `${JSON.stringify(all, null, 2)}\n`, "utf8");
}
