import { z } from "zod";

export const Language = z.enum(["de", "en"]);
export type Language = z.infer<typeof Language>;

export const Tone = z.enum([
  "calm",
  "confident",
  "playful",
  "urgent",
  "spiritual",
  "professional",
  "warm",
  "edgy",
]);
export type Tone = z.infer<typeof Tone>;

export const Tenant = z.object({
  id: z.string().uuid(),
  owner_user_id: z.string().uuid(),
  name: z.string().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable().optional(),
});
export type Tenant = z.infer<typeof Tenant>;

export const Project = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  language: Language,
  default_voice_id: z.string().nullable().optional(),
  auto_post_enabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable().optional(),
});
export type Project = z.infer<typeof Project>;

export const ProjectInput = Project.pick({
  name: true,
  slug: true,
  language: true,
  default_voice_id: true,
  auto_post_enabled: true,
}).partial({ default_voice_id: true, auto_post_enabled: true });
export type ProjectInput = z.infer<typeof ProjectInput>;

export const SecretKind = z.enum(["anthropic", "elevenlabs", "higgsfield", "meta"]);
export type SecretKind = z.infer<typeof SecretKind>;

export const JobStatus = z.enum([
  "queued",
  "planning",
  "analyzing",
  "composing",
  "rendering",
  "evaluating",
  "posting",
  "done",
  "failed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatus>;
