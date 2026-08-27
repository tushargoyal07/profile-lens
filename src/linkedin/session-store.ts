import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SESSION_PATH = "data/linkedin-session.json";

interface StoredSession {
  cookies: Record<string, string>;
  savedAt: string;
}

export async function loadStoredSession(): Promise<Record<string, string> | null> {
  try {
    const raw = await readFile(SESSION_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.cookies || typeof parsed.cookies !== "object") {
      return null;
    }
    return parsed.cookies;
  } catch {
    return null;
  }
}

export async function saveStoredSession(cookies: Record<string, string>): Promise<void> {
  await mkdir(dirname(SESSION_PATH), { recursive: true });
  const payload: StoredSession = {
    cookies,
    savedAt: new Date().toISOString(),
  };
  await writeFile(SESSION_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function clearStoredSession(): Promise<void> {
  try {
    await writeFile(SESSION_PATH, "", "utf8");
  } catch {
    // ignore
  }
}
