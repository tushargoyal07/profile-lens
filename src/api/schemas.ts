import { z } from "zod";

export const profileRequestSchema = z.object({
  url: z
    .string({ required_error: "url is required" })
    .min(1, "A LinkedIn profile URL is required.")
    .max(2048, "url must be at most 2048 characters"),
});

export const profileDateSchema = z.object({
  year: z.number().int(),
  month: z.number().int().nullable(),
  day: z.number().int().nullable(),
});

export const experienceSchema = z.object({
  title: z.string().nullable(),
  companyName: z.string().nullable(),
  companyUrl: z.string().nullable(),
  location: z.string().nullable(),
  description: z.string().nullable(),
  employmentType: z.string().nullable(),
  start: profileDateSchema.nullable(),
  end: profileDateSchema.nullable(),
  current: z.boolean(),
});

export const educationSchema = z.object({
  schoolName: z.string().nullable(),
  schoolUrl: z.string().nullable(),
  degree: z.string().nullable(),
  fieldOfStudy: z.string().nullable(),
  description: z.string().nullable(),
  start: profileDateSchema.nullable(),
  end: profileDateSchema.nullable(),
});

export const skillSchema = z.object({
  name: z.string(),
  endorsementCount: z.number().int().nullable(),
});

export const certificationSchema = z.object({
  name: z.string().nullable(),
  authority: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  url: z.string().nullable(),
  start: profileDateSchema.nullable(),
  end: profileDateSchema.nullable(),
});

export const languageSchema = z.object({
  name: z.string().nullable(),
  proficiency: z.string().nullable(),
});

export const profileResponseSchema = z.object({
  input: z.object({
    url: z.string(),
    publicIdentifier: z.string(),
  }),
  profile: z.object({
    fullName: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    headline: z.string().nullable(),
    about: z.string().nullable(),
    location: z.string().nullable(),
    industry: z.string().nullable(),
    pronouns: z.string().nullable(),
    profileUrl: z.string(),
    premium: z.boolean().nullable(),
    influencer: z.boolean().nullable(),
    images: z.object({
      profile: z.string().nullable(),
      background: z.string().nullable(),
    }),
    contact: z.object({
      email: z.string().nullable(),
      websites: z.array(z.string()),
      twitter: z.array(z.string()),
    }),
  }),
  experience: z.array(experienceSchema),
  education: z.array(educationSchema),
  skills: z.array(skillSchema),
  certifications: z.array(certificationSchema),
  languages: z.array(languageSchema),
  volunteer: z.array(experienceSchema),
  meta: z.object({
    fetchedAt: z.string(),
    sources: z.array(z.string()),
    partial: z.boolean(),
  }),
});

export type ProfileRequest = z.infer<typeof profileRequestSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Education = z.infer<typeof educationSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type Certification = z.infer<typeof certificationSchema>;
export type Language = z.infer<typeof languageSchema>;
