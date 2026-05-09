import {
  type MarketingBrief,
  type SceneTag,
  Timeline,
  validateTimeline,
} from "../schemas";
import { structuredCall } from "../anthropic";

const TIMELINE_JSON_SCHEMA = {
  type: "object",
  required: ["version", "duration_s", "aspect_ratio", "entries"],
  properties: {
    version: { type: "integer", enum: [1] },
    duration_s: { type: "integer", enum: [15, 30, 60] },
    aspect_ratio: { type: "string", enum: ["9:16"] },
    entries: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        required: ["t_in", "t_out", "source", "src_in", "src_out"],
        properties: {
          t_in: { type: "number", minimum: 0 },
          t_out: { type: "number", minimum: 0 },
          source: { type: "string" },
          src_in: { type: "number", minimum: 0 },
          src_out: { type: "number", minimum: 0 },
          reframe: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["center", "subject", "manual"] },
              anchor_xy: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
              zoom: { type: "number", minimum: 1, maximum: 2 },
            },
          },
          transition_in: transitionSchema(),
          transition_out: transitionSchema(),
        },
      },
    },
    captions: {
      type: "array",
      items: {
        type: "object",
        required: ["t_in", "t_out", "text"],
        properties: {
          t_in: { type: "number", minimum: 0 },
          t_out: { type: "number", minimum: 0 },
          text: { type: "string", minLength: 1, maxLength: 120 },
          style: { type: "string", enum: ["headline", "subtitle", "caption"] },
          position: {
            type: "string",
            enum: ["top", "center", "bottom", "hook", "cta"],
          },
        },
      },
    },
    broll_requests: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "prompt", "duration", "model"],
        properties: {
          id: { type: "string" },
          prompt: { type: "string", minLength: 40, maxLength: 800 },
          duration: { type: "integer", enum: [4, 6, 8] },
          vendor: { type: "string", enum: ["higgsfield"] },
          model: { type: "string", enum: ["veo-3.1-fast", "seedance-2.0"] },
        },
      },
    },
    music_uri: { type: "string" },
  },
} as const;

function transitionSchema() {
  return {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["hard", "fade", "whip_pan", "dip_to_black", "crossfade"],
      },
      duration: { type: "number", minimum: 0, maximum: 1 },
      snap_to_beat: { type: "boolean" },
    },
  };
}

const SYSTEM = `You are a senior Reels editor. You receive a brief, a brand visual style, and a manifest of pre-tagged scenes from uploaded clips. Compose a Timeline that uses ONLY tagged scenes (good_for_reel=true preferred) plus optional B-roll requests for gaps.

Hard rules:
- Total duration MUST sum to target ±1s (15, 30, or 60).
- entries[].t_in must equal previous entries[].t_out (no gaps, no overlaps).
- Each entry's src_out - src_in must equal t_out - t_in.
- Source values are EITHER an asset_id from the manifest OR a NEW "broll_<n>" id you also list in broll_requests[].
- Hook (first 1.5s) must be the strongest scene — high-energy or visually arresting.
- CTA (last ~3s) closes with clear action — usually a caption + final shot.
- Pacing: short cuts (1.5–3s) for energy, longer (4–6s) for talking-head or detail.
- aspect_ratio is always 9:16.
- reframe.mode "subject" when faces are present; "center" otherwise.

Captions:
- Use the brief.hook as the first caption (start at t_in=0, end ~1.5s).
- Use the brief.cta as the last caption.
- Mid-reel captions are optional; only when they reinforce a beat.

B-roll fill:
- ONLY emit broll_requests when good_for_reel-true scenes don't fill the duration.
- Each prompt must include the brand visual_style verbatim + scene-specific direction + the negative directive: "No on-screen text, no captions, no logos. Pure cinematic footage only."`;

export async function composeTimeline(opts: {
  apiKey: string;
  brief: MarketingBrief;
  taggedScenes: SceneTag[];
  duration_s: 15 | 30 | 60;
  brandStyleDescription?: string;
  maxAttempts?: number;
}): Promise<Timeline> {
  const maxAttempts = opts.maxAttempts ?? 3;

  const sceneList = opts.taggedScenes
    .map((s) => {
      const dur = (s.end - s.start).toFixed(2);
      return `  - ${s.scene_id} [${dur}s] tags=${s.tags.join(",")} mood=${s.sentiment} talking_head=${s.is_talking_head} good=${s.good_for_reel}${s.notes ? ` notes="${s.notes}"` : ""}`;
    })
    .join("\n");

  const baseUser = `Marketing Brief:
- Audience: ${opts.brief.target_audience}
- Hook: ${opts.brief.hook}
- Value props: ${opts.brief.value_props.map((v) => `• ${v}`).join("\n  ")}
- CTA: ${opts.brief.cta}
- Tone: ${opts.brief.tone.join(", ")}
- Visual style: ${opts.brief.visual_style}
${opts.brandStyleDescription ? `- Brand color: ${opts.brandStyleDescription}` : ""}

Target duration: ${opts.duration_s}s

Tagged scenes available:
${sceneList || "(no tagged scenes — emit B-roll-only timeline)"}

Compose the Timeline via the timeline tool.`;

  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const user =
      attempt === 1
        ? baseUser
        : `${baseUser}\n\nPrevious attempt failed:\n${lastErrors.map((e) => `- ${e}`).join("\n")}\nFix.`;

    const tl = await structuredCall({
      apiKey: opts.apiKey,
      system: SYSTEM,
      user,
      tool_name: "timeline",
      tool_description: "Emit a structured Reel timeline.",
      schema: Timeline,
      json_schema: TIMELINE_JSON_SCHEMA,
      max_tokens: 8000,
    });
    const errors = validateTimeline(tl);
    if (errors.length === 0) return tl;
    lastErrors = errors;
  }
  throw new Error(
    `composeTimeline failed after ${maxAttempts} attempts. Last errors:\n${lastErrors.join("\n")}`,
  );
}
