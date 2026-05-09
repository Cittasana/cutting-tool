import { z } from "zod";

// ============================================================
// Domain primitives
// ============================================================
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

// ============================================================
// Multi-tenant
// ============================================================
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

// ============================================================
// Reel pipeline domain (ported from v1)
// ============================================================
export const MarketingBrief = z.object({
  language: Language,
  target_audience: z.string().min(20).max(280),
  hook: z.string().min(10).max(140),
  value_props: z.array(z.string().min(5).max(160)).min(2).max(4),
  cta: z.string().min(3).max(80),
  tone: z.array(Tone).min(1).max(3),
  visual_style: z.string().min(20).max(400),
});
export type MarketingBrief = z.infer<typeof MarketingBrief>;

export const ProductContext = z.object({
  url: z.string().url(),
  title: z.string(),
  headline: z.string().optional(),
  copy_chunks: z.array(z.string()),
  og_image_url: z.string().url().optional(),
  detected_language: Language.optional(),
});
export type ProductContext = z.infer<typeof ProductContext>;

export const RunConfig = z.object({
  url: z.string().url(),
  length_seconds: z.union([z.literal(30), z.literal(60)]),
  language: Language,
  voice_id: z.string().optional(),
  scene_eval_enabled: z.boolean().default(true),
});
export type RunConfig = z.infer<typeof RunConfig>;

export const TextStyle = z.enum(["headline", "subtitle", "caption"]);
export type TextStyle = z.infer<typeof TextStyle>;

export const TextPosition = z.enum(["top", "center", "bottom", "hook", "cta"]);
export type TextPosition = z.infer<typeof TextPosition>;

export const IconPosition = z.enum([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
]);
export type IconPosition = z.infer<typeof IconPosition>;

export const TextOverlaySchema = z.object({
  kind: z.literal("text"),
  value: z.string().min(1).max(120),
  position: TextPosition,
  style: TextStyle.default("subtitle"),
  start_at_s: z.number().min(0),
  end_at_s: z.number().min(0),
});
export type TextOverlay = z.infer<typeof TextOverlaySchema>;

export const IconOverlaySchema = z.object({
  kind: z.literal("icon"),
  name: z.string().min(2).max(40),
  position: IconPosition,
  start_at_s: z.number().min(0),
  end_at_s: z.number().min(0),
  size_pct: z.number().min(2).max(30).default(10),
});
export type IconOverlay = z.infer<typeof IconOverlaySchema>;

export const OverlayElement = z.discriminatedUnion("kind", [
  TextOverlaySchema,
  IconOverlaySchema,
]);
export type OverlayElement = z.infer<typeof OverlayElement>;

export const SceneDuration = z.union([z.literal(4), z.literal(6), z.literal(8)]);
export type SceneDuration = z.infer<typeof SceneDuration>;

export const Scene = z.object({
  index: z.number().int().min(1),
  kind: z.enum(["talking-head", "b-roll"]),
  model: z.enum(["seedance-2.0", "veo-3.1-fast"]),
  duration: SceneDuration,
  prompt: z.string().min(40).max(1200),
  voiceover_text: z.string().max(280),
  uses_native_audio: z.boolean(),
  chain_from_previous: z.boolean(),
  overlays: z.array(OverlayElement).max(6).default([]),
});
export type Scene = z.infer<typeof Scene>;

export const Storyboard = z.object({
  total_duration_seconds: z.union([z.literal(30), z.literal(60)]),
  aspect_ratio: z.literal("9:16"),
  scenes: z.array(Scene).min(3).max(12),
});
export type Storyboard = z.infer<typeof Storyboard>;

export const SceneEval = z.object({
  scene_index: z.number().int().min(1),
  matches_prompt: z.number().min(0).max(10),
  visual_quality: z.number().min(0).max(10),
  on_brand: z.number().min(0).max(10),
  text_clarity: z.number().min(0).max(10),
  graphics_correctness: z.number().min(0).max(10),
  has_unwanted_text: z.boolean(),
  pass: z.boolean(),
  issues: z.array(z.string()).max(5),
  prompt_revision_hint: z.string().max(400).optional(),
});
export type SceneEval = z.infer<typeof SceneEval>;

export const EvalIssue = z.object({
  severity: z.enum(["critical", "major", "minor"]),
  scene_index: z.number().int().optional(),
  description: z.string().max(280),
  fix_suggestion: z.string().max(280),
});
export type EvalIssue = z.infer<typeof EvalIssue>;

export const EvaluationReport = z.object({
  hook_strength: z.number().min(0).max(10),
  message_clarity: z.number().min(0).max(10),
  visual_cohesion: z.number().min(0).max(10),
  cta_effectiveness: z.number().min(0).max(10),
  pacing: z.number().min(0).max(10),
  typography_quality: z.number().min(0).max(10),
  pass: z.boolean(),
  issues: z.array(EvalIssue).max(10),
  one_line_verdict: z.string().max(200),
});
export type EvaluationReport = z.infer<typeof EvaluationReport>;

export function validateStoryboard(sb: Storyboard): string[] {
  const errors: string[] = [];
  const sum = sb.scenes.reduce((acc, s) => acc + s.duration, 0);
  if (Math.abs(sum - sb.total_duration_seconds) > 1) {
    errors.push(
      `scene durations sum to ${sum}s, expected ${sb.total_duration_seconds}±1s`,
    );
  }
  if (sb.scenes[0]?.chain_from_previous) {
    errors.push("scene 1 cannot chain_from_previous");
  }
  for (const s of sb.scenes) {
    if (
      s.model === "veo-3.1-fast" &&
      !s.uses_native_audio &&
      s.voiceover_text.trim().length === 0
    ) {
      errors.push(
        `scene ${s.index} (Veo, silent) has empty voiceover_text — required for ElevenLabs TTS`,
      );
    }
    if (s.model === "seedance-2.0" && !s.uses_native_audio) {
      errors.push(
        `scene ${s.index} (Seedance) has uses_native_audio=false — Seedance always provides audio; set true`,
      );
    }
    for (const ov of s.overlays) {
      if (ov.start_at_s < 0 || ov.end_at_s > s.duration) {
        errors.push(
          `scene ${s.index} overlay timing [${ov.start_at_s}, ${ov.end_at_s}] outside [0, ${s.duration}]`,
        );
      }
      if (ov.start_at_s >= ov.end_at_s) {
        errors.push(`scene ${s.index} overlay has non-positive duration`);
      }
    }
  }
  return errors;
}

// ============================================================
// Job lifecycle
// ============================================================
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

export const Job = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  workflow_run_id: z.string().nullable().optional(),
  status: JobStatus,
  progress: z.number().int().min(0).max(100),
  current_step: z.string().nullable().optional(),
  brand_preset_id: z.string().uuid().nullable().optional(),
  brand_preset_version: z.number().int().nullable().optional(),
  brief: MarketingBrief.nullable().optional(),
  storyboard: Storyboard.nullable().optional(),
  output_asset_id: z.string().uuid().nullable().optional(),
  error: z.unknown().nullable().optional(),
  created_at: z.string(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
});
export type Job = z.infer<typeof Job>;

export const JobEvent = z.object({
  id: z.number().int(),
  job_id: z.string().uuid(),
  ts: z.string(),
  type: z.enum([
    "step.started",
    "step.finished",
    "scene.preview",
    "agent.thought",
    "progress",
    "error",
  ]),
  payload: z.unknown(),
});
export type JobEvent = z.infer<typeof JobEvent>;

// ============================================================
// Cutting Agent (Phase 3) — analyze + compose for uploaded assets
// ============================================================

export const AssetSceneAnalysis = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
});
export type AssetSceneAnalysis = z.infer<typeof AssetSceneAnalysis>;

export const AssetAnalysis = z.object({
  kind: z.enum(["video", "image"]),
  duration_s: z.number().min(0),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
  fps: z.number().min(0),
  has_audio: z.boolean(),
  scenes: z.array(AssetSceneAnalysis).default([]),
  silence_segments: z
    .array(z.object({ start: z.number(), end: z.number() }))
    .default([]),
  thumbnails: z.array(z.string()).default([]), // sandbox-local paths or blob URLs
});
export type AssetAnalysis = z.infer<typeof AssetAnalysis>;

export const SceneTag = z.object({
  asset_id: z.string().uuid(),
  scene_id: z.string(), // "<asset_id>_s<index>"
  start: z.number().min(0),
  end: z.number().min(0),
  tags: z.array(z.string()).max(8).default([]),
  sentiment: z.enum(["high-energy", "calm", "intense", "playful", "neutral"]),
  is_talking_head: z.boolean(),
  good_for_reel: z.boolean(),
  best_moment_s: z.number().nullable().optional(), // offset within scene
  notes: z.string().max(200).optional(),
});
export type SceneTag = z.infer<typeof SceneTag>;

export const TimelineEntry = z.object({
  t_in: z.number().min(0),                 // position in final reel
  t_out: z.number().min(0),
  source: z.string(),                       // asset_id OR "broll_request_<n>" OR "ai_<n>"
  src_in: z.number().min(0),                // offset within source clip
  src_out: z.number().min(0),
  reframe: z
    .object({
      mode: z.enum(["center", "subject", "manual"]),
      anchor_xy: z.tuple([z.number(), z.number()]).optional(),
      zoom: z.number().min(1).max(2).default(1),
    })
    .optional(),
  transition_in: z
    .object({
      type: z.enum(["hard", "fade", "whip_pan", "dip_to_black", "crossfade"]),
      duration: z.number().min(0).max(1).default(0),
      snap_to_beat: z.boolean().default(false),
    })
    .optional(),
  transition_out: z
    .object({
      type: z.enum(["hard", "fade", "whip_pan", "dip_to_black", "crossfade"]),
      duration: z.number().min(0).max(1).default(0),
      snap_to_beat: z.boolean().default(false),
    })
    .optional(),
});
export type TimelineEntry = z.infer<typeof TimelineEntry>;

export const BrollRequest = z.object({
  id: z.string(),
  prompt: z.string().min(40).max(800),
  duration: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  vendor: z.literal("higgsfield").default("higgsfield"),
  model: z.enum(["veo-3.1-fast", "seedance-2.0"]),
});
export type BrollRequest = z.infer<typeof BrollRequest>;

export const Caption = z.object({
  t_in: z.number().min(0),
  t_out: z.number().min(0),
  text: z.string().min(1).max(120),
  style: TextStyle.default("subtitle"),
  position: TextPosition.default("bottom"),
});
export type Caption = z.infer<typeof Caption>;

export const Timeline = z.object({
  version: z.literal(1).default(1),
  duration_s: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  aspect_ratio: z.literal("9:16").default("9:16"),
  entries: z.array(TimelineEntry).min(1).max(40),
  captions: z.array(Caption).default([]),
  broll_requests: z.array(BrollRequest).default([]),
  music_uri: z.string().url().nullable().optional(),
});
export type Timeline = z.infer<typeof Timeline>;

export function validateTimeline(tl: Timeline): string[] {
  const errors: string[] = [];
  let cursor = 0;
  for (const e of tl.entries) {
    if (Math.abs(e.t_in - cursor) > 0.05) {
      errors.push(`entry t_in=${e.t_in} doesn't follow previous (expected ~${cursor.toFixed(2)})`);
    }
    if (e.t_out <= e.t_in) {
      errors.push(`entry t_out=${e.t_out} ≤ t_in=${e.t_in}`);
    }
    if (e.src_out <= e.src_in) {
      errors.push(`entry src_out=${e.src_out} ≤ src_in=${e.src_in}`);
    }
    cursor = e.t_out;
  }
  if (Math.abs(cursor - tl.duration_s) > 1) {
    errors.push(`timeline ends at ${cursor.toFixed(2)}s, expected ${tl.duration_s}±1s`);
  }
  return errors;
}
