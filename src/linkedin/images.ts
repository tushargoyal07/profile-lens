import { isObject, type JsonObject } from "../lib/json.js";
import { liText } from "./text.js";

function largestVectorUrl(vector: JsonObject | null): string | null {
  if (!vector) {
    return null;
  }
  const root = typeof vector.rootUrl === "string" ? vector.rootUrl : "";
  const artifacts = Array.isArray(vector.artifacts) ? vector.artifacts : [];
  if (artifacts.length === 0) {
    return liText(root);
  }

  let best: JsonObject | null = null;
  let bestWidth = -1;
  for (const item of artifacts) {
    if (!isObject(item)) {
      continue;
    }
    const width =
      (typeof item.width === "number" ? item.width : 0) ||
      (typeof item.height === "number" ? item.height : 0);
    if (width >= bestWidth) {
      bestWidth = width;
      best = item;
    }
  }
  if (!best) {
    return liText(root);
  }
  const segment =
    typeof best.fileIdentifyingUrlPathSegment === "string"
      ? best.fileIdentifyingUrlPathSegment
      : "";
  if (!root) {
    return liText(segment);
  }
  return `${root}${segment}`;
}

export function extractImageUrl(node: unknown): string | null {
  if (!node) {
    return null;
  }
  if (typeof node === "string") {
    return node.startsWith("http") ? node : null;
  }
  if (!isObject(node)) {
    return null;
  }

  const keys = [
    "url",
    "displayImageUrl",
    "photoUrl",
    "vectorImage",
    "displayImageReference",
    "displayImageReferenceResolutionResult",
    "displayImage",
    "originalImageDisplayImage",
    "backgroundImage",
    "profilePicture",
  ];

  for (const key of keys) {
    if (!(key in node)) {
      continue;
    }
    const value = node[key];
    if (key === "vectorImage" && isObject(value)) {
      const url = largestVectorUrl(value);
      if (url) {
        return url;
      }
    }
    if (typeof value === "string" && value.startsWith("http")) {
      return value;
    }
    const nested = extractImageUrl(value);
    if (nested) {
      return nested;
    }
  }

  if ("rootUrl" in node && "artifacts" in node) {
    return largestVectorUrl(node);
  }

  return null;
}

export function profileImages(profile: JsonObject): {
  profile: string | null;
  background: string | null;
} {
  const picture =
    extractImageUrl(profile.profilePicture) ??
    extractImageUrl(profile.profilePictureOriginalImage) ??
    extractImageUrl(profile.miniProfile) ??
    extractImageUrl(profile.displayPictureUrl);

  const background =
    extractImageUrl(profile.backgroundPicture) ??
    extractImageUrl(profile.backgroundImage) ??
    extractImageUrl(profile.coverImage);

  return { profile: picture, background };
}
