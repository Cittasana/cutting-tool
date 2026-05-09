import type Anthropic from "@anthropic-ai/sdk";
import {
  EvaluationReport,
  type MarketingBrief,
  type Storyboard,
} from "../schemas.js";
import { imageBlocksFromPaths, structuredCall } from "./client.js";

const FINAL_EVAL_JSON_SCHEMA = {
  type: "object",
  required: [
    "hook_strength",
    "message_clarity",
    "visual_cohesion",
    "cta_effectiveness",
    "pacing",
    "typography_quality",
    "pass",
    "issues",
    "one_line_verdict",
  ],
  properties: {
    hook_strength: { type: "number", minimum: 0, maximum: 10 },
    message_clarity: { type: "number", minimum: 0, maximum: 10 },
    visual_cohesion: { type: "number", minimum: 0, maximum: 10 },
    cta_effectiveness: { type: "number", minimum: 0, maximum: 10 },
    pacing: { type: "number", minimum: 0, maximum: 10 },
    typography_quality: { type: "number", minimum: 0, maximum: 10 },
    pass: { type: "boolean" },
    issues: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        required: ["severity", "description", "fix_suggestion"],
        properties: {
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          scene_index: { type: "integer" },
          description: { type: "string", maxLength: 280 },
          fix_suggestion: { type: "string", maxLength: 280 },
        },
      },
    },
    one_line_verdict: { type: "string", maxLength: 200 },
  },
} as const;

const SYSTEM = `You are the final marketing-quality gate for an Instagram Reel before it ships. You receive sampled frames from across the assembled reel and the original brief + storyboard.

Score these dimensions (0-10):
- "hook_strength": does the first 1.5s stop the scroll? Specific, surprising, painful enough?
- "message_clarity": after watching, is the value crystal clear?
- "visual_cohesion": consistent identity, lighting, and look across all clips?
- "cta_effectiveness": does the closing tell the viewer what to do, clearly?
- "pacing": rhythm — no dead air, no rushed transitions?
- "typography_quality": all on-screen text crisp, legible, no flickering or rendering glitches?

"pass" is true iff all six scores are ≥ 7 AND there are no "critical" issues.

"issues" is a triaged list. severity:
- critical: blocks shipping (e.g., wrong subject, illegible text, broken icons, missing CTA)
- major: should fix (e.g., weak hook, jarring cut between clips 3-4)
- minor: nice-to-have polish

"one_line_verdict" is a single sentence summary the user reads first.`;

export async function evaluateFinal(
  reelFramePaths: string[],
  brief: MarketingBrief,
  storyboard: Storyboard,
  veoVoiceoverTranscript: string,
) {
  const imageBlocks = await imageBlocksFromPaths(reelFramePaths);
  const user: Anthropic.MessageParam["content"] = [
    {
      type: "text",
      text: `Brief:
- Audience: ${brief.target_audience}
- Hook: ${brief.hook}
- Value props: ${brief.value_props.join(" / ")}
- CTA: ${brief.cta}
- Tone: ${brief.tone.join(", ")}

Storyboard: ${storyboard.scenes.length} scenes, total ${storyboard.total_duration_seconds}s
${storyboard.scenes.map((s) => `  Scene ${s.index} (${s.kind}, ${s.duration}s, ${s.model}): ${s.prompt.slice(0, 120)}…`).join("\n")}

Veo voiceover transcript (concatenated, in order):
${veoVoiceoverTranscript || "(no Veo scenes — full reel is Seedance native audio)"}

${reelFramePaths.length} sample frames from the assembled reel follow.

Emit the final evaluation via the final_eval tool.`,
    },
    ...imageBlocks,
  ];

  return await structuredCall({
    system: SYSTEM,
    user,
    tool_name: "final_eval",
    tool_description: "Emit the final marketing evaluation report.",
    schema: EvaluationReport,
    json_schema: FINAL_EVAL_JSON_SCHEMA,
    max_tokens: 2500,
  });
}
