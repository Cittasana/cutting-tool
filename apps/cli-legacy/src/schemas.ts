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
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(60),
  language: Language,
  font_de: z.string().optional(),
  font_en: z.string().optional(),
  auto_accept_storyboard: z.boolean().default(false),
  scene_eval_enabled: z.boolean().default(true),
  voice_id: z.string().optional(),
});
export type RunConfig = z.infer<typeof RunConfig>;

export const TextStyle = z.enum(["headline", "subtitle", "caption"]);
export type TextStyle = z.infer<typeof TextStyle>;

export const TextPosition = z.enum(["top", "center", "bottom", "hook", "cta"]);
export const IconPosition = z.enum([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
]);

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

export const SceneDuration = z.union([
  z.literal(4),
  z.literal(6),
  z.literal(8),
]);
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
