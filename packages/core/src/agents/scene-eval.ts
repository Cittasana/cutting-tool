import type Anthropic from "@anthropic-ai/sdk";
import {
  type MarketingBrief,
  type Scene,
  SceneEval,
} from "../schemas";
import { imageBlocksFromBase64Pngs, structuredCall } from "../anthropic";

const SCENE_EVAL_JSON_SCHEMA = {
  type: "object",
  required: [
    "scene_index",
    "matches_prompt",
    "visual_quality",
    "on_brand",
    "text_clarity",
    "graphics_correctness",
    "has_unwanted_text",
    "pass",
    "issues",
  ],
  properties: {
    scene_index: { type: "integer", minimum: 1 },
    matches_prompt: { type: "number", minimum: 0, maximum: 10 },
    visual_quality: { type: "number", minimum: 0, maximum: 10 },
    on_brand: { type: "number", minimum: 0, maximum: 10 },
    text_clarity: { type: "number", minimum: 0, maximum: 10 },
    graphics_correctness: { type: "number", minimum: 0, maximum: 10 },
    has_unwanted_text: { type: "boolean" },
    pass: { type: "boolean" },
    issues: { type: "array", maxItems: 5, items: { type: "string" } },
    prompt_revision_hint: { type: "string", maxLength: 400 },
  },
} as const;

const FOOTAGE_SYSTEM = `You are a senior post-production QC reviewer. Given 3 sample frames from a generated video clip plus the scene's prompt and brand brief, score it.

Rules:
- "matches_prompt": did the model produce what was asked (subject, setting, action)?
- "visual_quality": composition, lighting, focus, no artifacts.
- "on_brand": consistent with brief.visual_style and tone.
- "text_clarity": ALWAYS score 10 here — overlays haven't been applied yet, this stage doesn't evaluate text.
- "graphics_correctness": ALWAYS score 10 here — same reason.
- "has_unwanted_text": TRUE if you see ANY text/captions/signage/UI elements/watermarks the prompt did NOT explicitly request. This is critical — the video model is supposed to produce pure footage.
- "pass": true iff matches_prompt ≥ 7 AND visual_quality ≥ 7 AND on_brand ≥ 7 AND has_unwanted_text === false.
- "issues": short list of concrete problems.
- "prompt_revision_hint": if not passing, suggest a tightened prompt addition (≤ 400 chars). If has_unwanted_text, the hint MUST include strengthened negative-text directives.`;

export async function evaluateFootage(opts: {
  apiKey: string;
  scene: Scene;
  brief: MarketingBrief;
  frameBase64Pngs: string[];
}) {
  const { apiKey, scene, brief, frameBase64Pngs } = opts;
  const imageBlocks = await imageBlocksFromBase64Pngs(frameBase64Pngs);
  const user: Anthropic.MessageParam["content"] = [
    {
      type: "text",
      text: `Scene ${scene.index} (${scene.kind}, model=${scene.model}, ${scene.duration}s)
Prompt: ${scene.prompt}

Brand visual style: ${brief.visual_style}
Brand tone: ${brief.tone.join(", ")}

Score via the scene_eval tool. ${frameBase64Pngs.length} frames follow.`,
    },
    ...imageBlocks,
  ];

  return await structuredCall({
    apiKey,
    system: FOOTAGE_SYSTEM,
    user,
    tool_name: "scene_eval",
    tool_description: "Emit per-scene QC scores and pass/fail.",
    schema: SceneEval,
    json_schema: SCENE_EVAL_JSON_SCHEMA,
    max_tokens: 1500,
  });
}
