import type {
  Certification,
  Education,
  Experience,
  Language,
  ProfileResponse,
  Skill,
} from "../api/schemas.js";
import { isObject, type JsonObject } from "../lib/json.js";
import { profileImages } from "./images.js";
import {
  buildIndex,
  collectionElements,
  dashType,
  field,
  findIncluded,
  isDashType,
  type EntityIndex,
} from "./restli.js";
import { dateRange, liText, proficiencyLabel } from "./text.js";

function fullName(first: string | null, last: string | null): string | null {
  const parts = [first, last].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function locationFrom(profile: JsonObject, index: EntityIndex): string | null {
  const geo = field(profile, index, "geoLocation");
  if (isObject(geo)) {
    const nestedGeo = field(geo, index, "geo");
    const fromGeo =
      liText(isObject(nestedGeo) ? nestedGeo.defaultLocalizedName : null) ??
      liText(geo.geoLocationName) ??
      liText(geo.defaultLocalizedName);
    if (fromGeo) {
      return fromGeo;
    }
  }
  return (
    liText(profile.geoLocationName) ??
    liText(profile.locationName) ??
    liText(profile.location) ??
    (isObject(profile.location)
      ? (liText(profile.location.basicLocation) ?? liText(profile.location.countryCode))
      : null)
  );
}

function companyUrl(position: JsonObject, index: EntityIndex): string | null {
  const company = field(position, index, "company");
  if (isObject(company)) {
    const url =
      liText(company.url) ??
      liText(company.companyUrl) ??
      (typeof company.universalName === "string"
        ? `https://www.linkedin.com/company/${company.universalName}/`
        : null);
    if (url) {
      return url;
    }
  }
  return liText(position.companyUrl) ?? liText(position.url);
}

function asExperience(item: unknown, index: EntityIndex): Experience | null {
  if (!isObject(item)) {
    return null;
  }
  const company = field(item, index, "company");
  const range = dateRange(item.dateRange ?? item.timePeriod);
  const title = liText(item.title) ?? liText(item.localizedTitle);
  const companyName =
    liText(item.companyName) ??
    (isObject(company) ? (liText(company.name) ?? liText(company.localizedName)) : null) ??
    liText(item.subtitle);
  if (!title && !companyName) {
    return null;
  }
  return {
    title,
    companyName,
    companyUrl: companyUrl(item, index),
    location:
      liText(item.geoLocationName) ??
      liText(item.locationName) ??
      liText(item.location) ??
      liText(item.metadata),
    description: liText(item.description) ?? liText(item.descriptionText),
    employmentType: liText(item.employmentType) ?? liText(item.employmentTypeUrn),
    start: range.start,
    end: range.end,
    current: range.end === null && range.start !== null,
  };
}

function asEducation(item: unknown, index: EntityIndex): Education | null {
  if (!isObject(item)) {
    return null;
  }
  const school = field(item, index, "school");
  const range = dateRange(item.dateRange ?? item.timePeriod);
  const schoolName =
    liText(item.schoolName) ??
    (isObject(school) ? (liText(school.name) ?? liText(school.localizedName)) : null) ??
    liText(item.title);
  if (!schoolName && !liText(item.degreeName) && !liText(item.fieldOfStudy)) {
    return null;
  }
  const schoolUrl =
    (isObject(school) && typeof school.universalName === "string"
      ? `https://www.linkedin.com/school/${school.universalName}/`
      : null) ?? liText(item.schoolUrl);
  return {
    schoolName,
    schoolUrl,
    degree: liText(item.degreeName) ?? liText(item.degree) ?? liText(item.subtitle),
    fieldOfStudy: liText(item.fieldOfStudy),
    description: liText(item.description) ?? liText(item.notes),
    start: range.start,
    end: range.end,
  };
}

function asSkill(item: unknown): Skill | null {
  if (typeof item === "string") {
    const name = item.trim();
    return name ? { name, endorsementCount: null } : null;
  }
  if (!isObject(item)) {
    return null;
  }
  const nested = isObject(item.skill) ? item.skill : null;
  const name =
    liText(item.name) ??
    liText(item.localizedName) ??
    (nested ? liText(nested.name) : null);
  if (!name) {
    return null;
  }
  const endorsement =
    typeof item.endorsementCount === "number"
      ? item.endorsementCount
      : typeof item.numEndorsements === "number"
        ? item.numEndorsements
        : null;
  return { name, endorsementCount: endorsement };
}

function asCertification(item: unknown): Certification | null {
  if (!isObject(item)) {
    return null;
  }
  const range = dateRange(item.dateRange ?? item.timePeriod);
  const name = liText(item.name) ?? liText(item.title);
  if (!name) {
    return null;
  }
  return {
    name,
    authority: liText(item.authority) ?? liText(item.company) ?? liText(item.subtitle),
    licenseNumber: liText(item.licenseNumber) ?? liText(item.displaySource),
    url: liText(item.url) ?? liText(item.companyUrl),
    start: range.start,
    end: range.end,
  };
}

function asLanguage(item: unknown): Language | null {
  if (!isObject(item)) {
    return null;
  }
  const name = liText(item.name) ?? liText(item.localizedName);
  if (!name) {
    return null;
  }
  return {
    name,
    proficiency: proficiencyLabel(item.proficiency) ?? proficiencyLabel(item.proficiencyLevel),
  };
}

function orderedSection(
  profile: JsonObject,
  index: EntityIndex,
  fieldName: string,
  nestedField: string | null,
  typeNames: string[],
): JsonObject[] {
  const collection = field(profile, index, fieldName);
  const fromToc: JsonObject[] = [];
  for (const group of collectionElements(collection, index)) {
    if (!isObject(group)) {
      continue;
    }
    if (nestedField) {
      const nested = field(group, index, nestedField);
      const children = collectionElements(nested, index).filter(isObject);
      if (children.length > 0) {
        fromToc.push(...children);
        continue;
      }
    }
    if (isDashType(group, ...typeNames) || dashType(group) === "") {
      fromToc.push(group);
    }
  }
  if (fromToc.length > 0) {
    return fromToc;
  }
  return findIncluded(index, ...typeNames);
}

function findProfileEntity(
  payload: JsonObject,
  index: EntityIndex,
  publicIdentifier: string,
): JsonObject | null {
  const data = isObject(payload.data) ? payload.data : payload;
  for (const item of collectionElements(data, index)) {
    if (isObject(item) && (item.firstName || item.publicIdentifier || item.headline)) {
      return item;
    }
  }

  for (const item of index.values()) {
    if (
      isDashType(item, "Profile") &&
      (item.publicIdentifier === publicIdentifier || item.firstName)
    ) {
      return item;
    }
  }

  for (const item of index.values()) {
    if (item.publicIdentifier === publicIdentifier && isObject(item)) {
      return item;
    }
  }

  const elements = payload.elements;
  if (Array.isArray(elements) && isObject(elements[0])) {
    return elements[0];
  }

  return null;
}

function websitesFrom(profile: JsonObject): string[] {
  const raw = profile.websites ?? profile.website ?? profile.creatorWebsite;
  const out: string[] = [];
  const push = (value: unknown) => {
    const url = liText(value);
    if (url) {
      out.push(url);
    }
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isObject(item)) {
        push(item.url ?? item.address ?? item);
      } else {
        push(item);
      }
    }
  } else {
    push(raw);
  }
  return [...new Set(out)];
}

function twitterFrom(profile: JsonObject): string[] {
  const raw = profile.twitterHandles ?? profile.twitter;
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const handle = isObject(item)
        ? (liText(item.name) ?? liText(item.credential) ?? liText(item))
        : liText(item);
      if (handle) {
        out.push(handle);
      }
    }
  }
  return out;
}

export function parseDashProfile(
  payload: JsonObject,
  publicIdentifier: string,
): Partial<ProfileResponse> | null {
  const index = buildIndex(payload);
  const profile = findProfileEntity(payload, index, publicIdentifier);
  if (!profile) {
    return null;
  }

  const firstName = liText(profile.firstName);
  const lastName = liText(profile.lastName);
  const images = profileImages(profile);
  const emailObject = field(profile, index, "emailAddress");
  const email = isObject(emailObject)
    ? liText(emailObject.emailAddress)
    : liText(profile.emailAddress);

  return {
    profile: {
      fullName: fullName(firstName, lastName),
      firstName,
      lastName,
      headline: liText(profile.headline),
      about: liText(profile.summary) ?? liText(profile.about),
      location: locationFrom(profile, index),
      industry: liText(profile.industry) ?? liText(profile.industryName),
      pronouns: liText(profile.pronouns) ?? liText(profile.pronounUnion),
      profileUrl: `https://www.linkedin.com/in/${liText(profile.publicIdentifier) ?? publicIdentifier}/`,
      premium: typeof profile.premium === "boolean" ? profile.premium : null,
      influencer: typeof profile.influencer === "boolean" ? profile.influencer : null,
      images,
      contact: {
        email,
        websites: websitesFrom(profile),
        twitter: twitterFrom(profile),
      },
    },
    experience: orderedSection(
      profile,
      index,
      "profilePositionGroups",
      "profilePositionInPositionGroup",
      ["Position"],
    )
      .map((item) => asExperience(item, index))
      .filter((item): item is Experience => item !== null),
    education: orderedSection(profile, index, "profileEducations", null, ["Education"])
      .map((item) => asEducation(item, index))
      .filter((item): item is Education => item !== null),
    skills: orderedSection(profile, index, "profileSkills", null, ["Skill"])
      .map(asSkill)
      .filter((item): item is Skill => item !== null),
    certifications: orderedSection(
      profile,
      index,
      "profileCertifications",
      null,
      ["Certification"],
    )
      .map(asCertification)
      .filter((item): item is Certification => item !== null),
    languages: orderedSection(profile, index, "profileLanguages", null, ["Language"])
      .map(asLanguage)
      .filter((item): item is Language => item !== null),
    volunteer: orderedSection(
      profile,
      index,
      "profileVolunteerExperiences",
      null,
      ["VolunteerExperience"],
    )
      .map((item) => asExperience(item, index))
      .filter((item): item is Experience => item !== null),
  };
}

export function parseProfileView(
  payload: JsonObject,
  publicIdentifier: string,
): Partial<ProfileResponse> | null {
  const profile = isObject(payload.profile) ? payload.profile : null;
  if (!profile) {
    return null;
  }
  const mini = isObject(profile.miniProfile) ? profile.miniProfile : profile;
  const firstName = liText(mini.firstName) ?? liText(profile.firstName);
  const lastName = liText(mini.lastName) ?? liText(profile.lastName);
  const emptyIndex = new Map();
  const viewElements = (key: string): unknown[] => {
    const view = payload[key];
    return isObject(view) && Array.isArray(view.elements) ? view.elements : [];
  };

  return {
    profile: {
      fullName: fullName(firstName, lastName),
      firstName,
      lastName,
      headline: liText(profile.headline) ?? liText(mini.occupation),
      about: liText(profile.summary),
      location:
        liText(profile.locationName) ??
        liText(profile.geoCountryName) ??
        (isObject(profile.location) ? liText(profile.location.basicLocation) : null),
      industry: liText(profile.industryName),
      pronouns: liText(profile.pronouns),
      profileUrl: `https://www.linkedin.com/in/${liText(mini.publicIdentifier) ?? publicIdentifier}/`,
      premium: null,
      influencer: null,
      images: profileImages(isObject(mini) ? { ...profile, ...mini } : profile),
      contact: {
        email: liText(profile.emailAddress),
        websites: websitesFrom(profile),
        twitter: twitterFrom(profile),
      },
    },
    experience: viewElements("positionView")
      .map((item) => asExperience(item, emptyIndex))
      .filter((item): item is Experience => item !== null),
    education: viewElements("educationView")
      .map((item) => asEducation(item, emptyIndex))
      .filter((item): item is Education => item !== null),
    skills: viewElements("skillView")
      .map(asSkill)
      .filter((item): item is Skill => item !== null),
    certifications: viewElements("certificationView")
      .map(asCertification)
      .filter((item): item is Certification => item !== null),
    languages: viewElements("languageView")
      .map(asLanguage)
      .filter((item): item is Language => item !== null),
    volunteer: viewElements("volunteerExperienceView")
      .map((item) => asExperience(item, emptyIndex))
      .filter((item): item is Experience => item !== null),
  };
}

export function parseSkillsPayload(payload: JsonObject): Skill[] {
  const skills: Skill[] = [];
  const index = buildIndex(payload);
  const data = isObject(payload.data) ? payload.data : payload;
  const elements = collectionElements(data, index);
  const source = elements.length
    ? elements
    : Array.isArray(payload.elements)
      ? payload.elements
      : [];

  for (const item of source) {
    if (isObject(item) && Array.isArray(item.endorsedSkills)) {
      for (const nested of item.endorsedSkills) {
        const skill = asSkill(nested);
        if (skill) {
          skills.push(skill);
        }
      }
      continue;
    }
    const skill = asSkill(item);
    if (skill) {
      skills.push(skill);
    }
  }

  const seen = new Set<string>();
  return skills.filter((skill) => {
    const key = skill.name.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function parseContactInfo(payload: JsonObject): {
  email: string | null;
  websites: string[];
  twitter: string[];
} {
  return {
    email: liText(payload.emailAddress),
    websites: websitesFrom(payload),
    twitter: twitterFrom(payload),
  };
}

function listEmpty<T>(items: T[] | undefined): boolean {
  return !items || items.length === 0;
}

export function mergeProfiles(
  primary: Partial<ProfileResponse>,
  fallback: Partial<ProfileResponse> | null,
): Partial<ProfileResponse> {
  if (!fallback) {
    return primary;
  }
  const p = primary.profile;
  const f = fallback.profile;
  return {
    profile: p
      ? {
          fullName: p.fullName ?? f?.fullName ?? null,
          firstName: p.firstName ?? f?.firstName ?? null,
          lastName: p.lastName ?? f?.lastName ?? null,
          headline: p.headline ?? f?.headline ?? null,
          about: p.about ?? f?.about ?? null,
          location: p.location ?? f?.location ?? null,
          industry: p.industry ?? f?.industry ?? null,
          pronouns: p.pronouns ?? f?.pronouns ?? null,
          profileUrl: p.profileUrl,
          premium: p.premium ?? f?.premium ?? null,
          influencer: p.influencer ?? f?.influencer ?? null,
          images: {
            profile: p.images.profile ?? f?.images.profile ?? null,
            background: p.images.background ?? f?.images.background ?? null,
          },
          contact: {
            email: p.contact.email ?? f?.contact.email ?? null,
            websites: p.contact.websites.length ? p.contact.websites : (f?.contact.websites ?? []),
            twitter: p.contact.twitter.length ? p.contact.twitter : (f?.contact.twitter ?? []),
          },
        }
      : f,
    experience: listEmpty(primary.experience) ? fallback.experience : primary.experience,
    education: listEmpty(primary.education) ? fallback.education : primary.education,
    skills: listEmpty(primary.skills) ? fallback.skills : primary.skills,
    certifications: listEmpty(primary.certifications)
      ? fallback.certifications
      : primary.certifications,
    languages: listEmpty(primary.languages) ? fallback.languages : primary.languages,
    volunteer: listEmpty(primary.volunteer) ? fallback.volunteer : primary.volunteer,
  };
}

export function isThinProfile(parsed: Partial<ProfileResponse> | null): boolean {
  if (!parsed?.profile?.fullName && !parsed?.profile?.headline) {
    return true;
  }
  return listEmpty(parsed.experience) && listEmpty(parsed.education) && listEmpty(parsed.skills);
}
