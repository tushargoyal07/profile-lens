import { isObject, type JsonObject } from "../lib/json.js";

export type EntityIndex = Map<string, JsonObject>;

export function buildIndex(payload: JsonObject): EntityIndex {
  const index: EntityIndex = new Map();
  const included = payload.included;
  if (Array.isArray(included)) {
    for (const item of included) {
      if (isObject(item) && typeof item.entityUrn === "string") {
        index.set(item.entityUrn, item);
      }
    }
  }
  const data = payload.data;
  if (isObject(data) && typeof data.entityUrn === "string") {
    if (!index.has(data.entityUrn)) {
      index.set(data.entityUrn, data);
    }
  }
  return index;
}

export function dashType(obj: unknown): string {
  if (!isObject(obj)) {
    return "";
  }
  const typeName = obj.$type ?? obj._type;
  if (typeof typeName !== "string") {
    return "";
  }
  const parts = typeName.split(".");
  return parts[parts.length - 1] ?? "";
}

export function isDashType(obj: unknown, ...names: string[]): boolean {
  return names.includes(dashType(obj));
}

export function resolveRef(ref: unknown, index: EntityIndex): unknown {
  if (typeof ref === "string") {
    return index.get(ref) ?? ref;
  }
  return ref;
}

export function field(
  obj: JsonObject | null | undefined,
  index: EntityIndex,
  name: string,
): unknown {
  if (!obj) {
    return undefined;
  }
  for (const key of [`*${name}`, `${name}~`, name]) {
    if (!(key in obj) || obj[key] === null || obj[key] === undefined) {
      continue;
    }
    const value = obj[key];
    if (typeof value === "string" && value.startsWith("urn:")) {
      return index.get(value) ?? value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => resolveRef(item, index));
    }
    if (isObject(value) && typeof value.entityUrn === "string") {
      const resolved = index.get(value.entityUrn);
      if (resolved) {
        return { ...resolved, ...value };
      }
    }
    return resolveRef(value, index);
  }
  return undefined;
}

export function collectionElements(node: unknown, index: EntityIndex): unknown[] {
  if (node === null || node === undefined) {
    return [];
  }
  if (Array.isArray(node)) {
    return node.map((item) => resolveRef(item, index));
  }
  if (typeof node === "string") {
    return collectionElements(resolveRef(node, index), index);
  }
  if (!isObject(node)) {
    return [];
  }

  for (const key of ["*elements", "elements"] as const) {
    if (!(key in node) || node[key] === null || node[key] === undefined) {
      continue;
    }
    const value = node[key];
    if (typeof value === "string") {
      return collectionElements(resolveRef(value, index), index);
    }
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (const item of value) {
        const resolved = resolveRef(item, index);
        if (isObject(resolved) && ("*elements" in resolved || "elements" in resolved)) {
          items.push(...collectionElements(resolved, index));
        } else {
          items.push(resolved);
        }
      }
      return items;
    }
  }
  return [];
}

export function findIncluded(index: EntityIndex, ...typeNames: string[]): JsonObject[] {
  const matches: JsonObject[] = [];
  for (const item of index.values()) {
    if (isDashType(item, ...typeNames)) {
      matches.push(item);
    }
  }
  return matches;
}
