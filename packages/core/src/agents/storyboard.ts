import { type MarketingBrief, Storyboard, validateStoryboard } from "../schemas";
import { structuredCall } from "../anthropic";

function buildJsonSchema(availableIcons: string[]) {
  const overlayElement = {
    oneOf: [
      {
        type: "object",
        required: ["kind", "value", "position", "start_at_s", "end_at_s"],
        properties: {
          kind: { type: "string", enum: ["text"] },
          value: { type: "string", minLength: 1, maxLength: 120 },
          position: { type: "string", enum: ["top", "center", "bottom", "hook", "cta"] },
          style: { type: "string", enum: ["headline", "subtitle", "caption"] },
          start_at_s: { type: "number", minimum: 0 },
          end_at_s: { type: "number", minimum: 0 },
        },
      },
      {
        type: "object",
        required: ["kind", "name", "position", "start_at_s", "end_at_s"],
        properties: {
          kind: { type: "string", enum: ["icon"] },
          name: { type: "string", enum: availableIcons.length ? availableIcons : ["__none__"] },
          position: { type: "string", enum: ["top-left", "top-right", "bottom-left", "bottom-right", "center"] },
          start_at_s: { type: "number", minimum: 0 },
          end_at_s: { type: "number", minimum: 0 },
          size_pct: { type: "number", minimum: 2, maximum: 30 },
        },
      },
    ],
  };

  return {
    type: "object",
    required: ["total_duration_seconds", "aspect_ratio", "scenes"],
    properties: {
      total_duration_seconds: { type: "integer", enum: [30, 60] },
      aspect_ratio: { type: "string", enum: ["9:16"] },
      scenes: {
        type: "array",
        minItems: 3,
        maxItems: 12,
        items: {
          type: "object",
          required: [
            "index", "kind", "model", "duration", "prompt",
            "voiceover_text", "uses_native_audio", "chain_from_previous", "overlays",
          ],
          properties: {
            index: { type: "integer", minimum: 1 },
            kind: { type: "string", enum: ["talking-head", "b-roll"] },
            model: { type: "string", enum: ["seedance-2.0", "veo-3.1-fast"] },
            duration: { type: "integer", enum: [4, 6, 8] },
            prompt: { type: "string", minLength: 40, maxLength: 1200 },
            voiceover_text: { type: "string", maxLength: 280 },
            uses_native_audio: { type: "boolean" },
            chain_from_previous: { type: "boolean" },
            overlays: { type: "array", maxItems: 6, items: overlayElement },
          },
        },
      },
    },
  };
}

const SYSTEM = `You are a Reels director planning a multi-clip shoot. Given a marketing brief and target length (30 or 60s), output a storyboard.

HARD CONSTRAINTS:
- Each scene's duration is ONE of {4, 6, 8} seconds. Sum of all scene.duration MUST equal total_duration_seconds (±1 not allowed — exact).
- Scene 1 has chain_from_previous=false. All others may chain.
- Models:
  * "seedance-2.0" → talking-head only, ALWAYS uses_native_audio=true (Seedance speaks; voiceover_text empty).
  * "veo-3.1-fast" → b-roll, ALWAYS uses_native_audio=false (silent), MUST have voiceover_text (≤ duration × 22 chars rough cap so ElevenLabs fits).
- Frame chaining (chain_from_previous=true) is RELIABLE only between consecutive Veo b-roll scenes. AVOID chaining Seedance scenes — Seedance image conditioning is loose and may cause subject drift. Talking-head Seedance scenes use chain_from_previous=false.
- CLUSTER b-roll runs together so chaining lives where it works.
- ASPECT RATIO is always 9:16.

VISUAL PROMPTS:
- Prepend the brief.visual_style to every prompt verbatim, then add the scene-specific direction.
- ALWAYS include this negative directive at the END of every prompt: "No on-screen text, no captions, no subtitles, no logos, no UI elements, no watermarks. Pure cinematic footage only."
- Diegetic transitions: when chain_from_previous=true, the prompt must describe the OPENING frame as a continuation of the previous scene's closing frame.

OVERLAYS:
- All on-screen text and icons go in scene.overlays. The video model never renders them.
- "hook" position is for the first scene's grabber text.
- "cta" position is for the closing CTA.
- start_at_s/end_at_s are relative to the scene (0 to scene.duration).
- Use icons sparingly (0-2 per scene). Only use icon names from the AVAILABLE list provided.

VOICEOVER:
- For Veo (silent) scenes: voiceover_text is what ElevenLabs will speak. Keep it tight, conversational, in the brief's language.
- The full reel's voiceover (Veo scenes only) should connect into a coherent narrative. Seedance talking-head scenes carry their own dialog (you decide what they say in the prompt).`;

export async function generateStoryboard(opts: {
  apiKey: string;
  brief: MarketingBrief;
  length_seconds: 30 | 60;
  availableIcons?: string[];
  maxAttempts?: number;
}) {
  const { apiKey, brief, length_seconds } = opts;
  const icons = opts.availableIcons ?? [];
  const maxAttempts = opts.maxAttempts ?? 3;
  const json_schema = buildJsonSchema(icons);

  const baseUser = `Marketing Brief:
- Language: ${brief.language}
- Audience: ${brief.target_audience}
- Hook: ${brief.hook}
- Value props: ${brief.value_props.map((v) => `• ${v}`).join("\n  ")}
- CTA: ${brief.cta}
- Tone: ${brief.tone.join(", ")}
- Visual style: ${brief.visual_style}

Target Reel length: ${length_seconds}s
Available icons: ${icons.length ? icons.join(", ") : "(none — do not emit icon overlays)"}

Produce the storyboard via the storyboard tool.`;

  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const user =
      attempt === 1
        ? baseUser
        : `${baseUser}\n\nPrevious attempt failed with these errors:\n${lastErrors.map((e) => `- ${e}`).join("\n")}\nFix them.`;

    const sb = await structuredCall({
      apiKey,
      system: SYSTEM,
      user,
      tool_name: "storyboard",
      tool_description: "Emit the structured storyboard for the Reel.",
      schema: Storyboard,
      json_schema,
      max_tokens: 6000,
    });
    const errors = validateStoryboard(sb);
    if (errors.length === 0) return sb;
    lastErrors = errors;
  }
  throw new Error(
    `Storyboard generation failed after ${maxAttempts} attempts. Last errors:\n${lastErrors.join("\n")}`,
  );
}
