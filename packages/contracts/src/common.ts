import { z } from "zod";

export const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "must be an opaque identifier");

export const VersionSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "must be an immutable version label");

export const SafeReferenceSchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, "must be a non-secret reference, not free text");

export const IsoTimestampSchema = z.string().datetime({ offset: true });
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "must be a lowercase SHA-256 digest");

export const HttpsUrlSchema = z
  .url()
  .refine((value) => value.startsWith("https://"), "must use HTTPS");

export const LanguagePackSchema = z.literal("ase-US");
export type LanguagePack = z.infer<typeof LanguagePackSchema>;

export const LocaleSchema = z.literal("en-US");
export type Locale = z.infer<typeof LocaleSchema>;
