import { isObject } from "../lib/json.js";

export function liText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    return text || null;
  }
  if (isObject(value)) {
    for (const key of ["text", "localized", "value", "name"]) {
      const nested = liText(value[key]);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

export interface ProfileDate {
  year: number;
  month: number | null;
  day: number | null;
}

export function liDate(value: unknown): ProfileDate | null {
  if (!isObject(value)) {
    return null;
  }
  const year = value.year;
  if (typeof year !== "number") {
    return null;
  }
  return {
    year,
    month: typeof value.month === "number" ? value.month : null,
    day: typeof value.day === "number" ? value.day : null,
  };
}

export function dateRange(value: unknown): {
  start: ProfileDate | null;
  end: ProfileDate | null;
} {
  if (!isObject(value)) {
    return { start: null, end: null };
  }
  return {
    start: liDate(value.start),
    end: liDate(value.end),
  };
}

const PROFICIENCY: Record<string, string> = {
  NATIVE_OR_BILINGUAL: "Native or bilingual",
  FULL_PROFESSIONAL: "Full professional",
  PROFESSIONAL_WORKING: "Professional working",
  LIMITED_WORKING: "Limited working",
  ELEMENTARY: "Elementary",
};

export function proficiencyLabel(value: unknown): string | null {
  const raw = liText(value);
  if (!raw) {
    return null;
  }
  return PROFICIENCY[raw] ?? raw.replaceAll("_", " ").toLowerCase();
}
