import type Anthropic from "@anthropic-ai/sdk";
import { SceneTag } from "../schemas";
import { TAGGING_MODEL, imageBlocksFromBase64Pngs, structuredCall } from "../anthropic";

const SCENE_TAG_JSON_SCHEMA = {
  type: "object",
  required: [
    "asset_id",
    "scene_id",
    "start",
    "end",
    "tags",
    "sentiment",
    "is_talking_head",
    "good_for_reel",
  ],
  properties: {
    asset_id: { type: "string" },
    scene_id: { type: "string" },
    start: { type: "number", minimum: 0 },
    end: { type: "number", minimum: 0 },
    tags: { type: "array", maxItems: 8, items: { type: "string" } },
    sentiment: {
      type: "string",
      enum: ["high-energy", "calm", "intense", "playful", "neutral"],
    },
    is_talking_head: { type: "boolean" },
    good_for_reel: { type: "boolean" },
    best_moment_s: { type: "number" },
    notes: { type: "string", maxLength: 200 },
  },
} as const;

const SYSTEM = `You are a video-editor assistant tagging individual scenes from uploaded footage. You receive 1–4 representative thumbnails plus optional transcript and metadata.

Score the scene for use in a short Reel:
- "tags": 3–8 short keywords that describe what's visible (subjects, actions, settings, lighting, motion).
- "sentiment": single best label.
- "is_talking_head": true if a person is speaking directly to camera (mouth-visible, framed for face).
- "good_for_reel": true iff the scene has clear visual interest (no boring static shots, no broken footage, no duplicates of nearby scenes).
- "best_moment_s": offset (relative to scene start) of the strongest single frame, if any.
- "notes": one short sentence on use case (≤ 200 chars).

Be ruthless about good_for_reel — bad shots are dead weight in a 30s reel.`;

export async function tagScene(opts: {
  apiKey: string;
  asset_id: string;
  scene_id: string;
  start: number;
  end: number;
  thumbnailBase64Pngs: string[];
  transcriptSnippet?: string;
  metadataNote?: string;
}): Promise<SceneTag> {
  const imageBlocks = await imageBlocksFromBase64Pngs(opts.thumbnailBase64Pngs);
  const user: Anthropic.MessageParam["content"] = [
    {
      type: "text",
      text: `Asset: ${opts.asset_id}
Scene: ${opts.scene_id} (${opts.start.toFixed(2)}s — ${opts.end.toFixed(2)}s, duration ${(opts.end - opts.start).toFixed(2)}s)
${opts.transcriptSnippet ? `Transcript: ${opts.transcriptSnippet.slice(0, 600)}` : ""}
${opts.metadataNote ? `Metadata: ${opts.metadataNote}` : ""}

Frames follow. Emit the scene tag.`,
    },
    ...imageBlocks,
  ];
  return await structuredCall({
    apiKey: opts.apiKey,
    model: TAGGING_MODEL,
    system: SYSTEM,
    user,
    tool_name: "scene_tag",
    tool_description: "Emit a structured tag record for one scene.",
    schema: SceneTag,
    json_schema: SCENE_TAG_JSON_SCHEMA,
    max_tokens: 600,
  });
}
