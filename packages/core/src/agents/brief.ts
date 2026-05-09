import { MarketingBrief, type ProductContext } from "../schemas";
import { structuredCall } from "../anthropic";

const BRIEF_JSON_SCHEMA = {
  type: "object",
  required: ["language", "target_audience", "hook", "value_props", "cta", "tone", "visual_style"],
  properties: {
    language: { type: "string", enum: ["de", "en"] },
    target_audience: { type: "string", minLength: 20, maxLength: 280 },
    hook: { type: "string", minLength: 10, maxLength: 140 },
    value_props: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: { type: "string", minLength: 5, maxLength: 160 },
    },
    cta: { type: "string", minLength: 3, maxLength: 80 },
    tone: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "string",
        enum: ["calm", "confident", "playful", "urgent", "spiritual", "professional", "warm", "edgy"],
      },
    },
    visual_style: { type: "string", minLength: 20, maxLength: 400 },
  },
} as const;

const SYSTEM = `You are a senior performance marketer specializing in Instagram Reels for European wellness, coaching, and SaaS brands. Given a scraped product context, produce a tight marketing brief that will guide a 30s or 60s Reel storyboard.

Rules:
- Pick ONE language for the entire brief (matches the product's primary audience).
- "hook" is the first 1.5s of the Reel — must stop the scroll. Concrete pain or unexpected claim, not a generic question.
- "value_props" are 2-4 short benefit-led statements (not features).
- "cta" is what the viewer does next (visit URL, save the post, comment X).
- "tone" picks 1-3 from the allowed set; consistent with the brand's voice on the source page.
- "visual_style" is a 1-2 sentence description with concrete identity anchors (subject's age range, gender if any, clothing palette, lighting, location archetype, lens feel). This text gets prepended to every video-generation prompt to keep visual identity consistent across clips. Be specific.`;

export async function generateBrief(opts: {
  apiKey: string;
  ctx: ProductContext;
  length_seconds: 30 | 60;
}) {
  const { apiKey, ctx, length_seconds } = opts;
  const user = `Product URL: ${ctx.url}
Title: ${ctx.title}
Headline: ${ctx.headline ?? "(none)"}
Detected language: ${ctx.detected_language ?? "unknown"}
Target Reel length: ${length_seconds}s

Top page copy (first 25 chunks):
${ctx.copy_chunks.slice(0, 25).map((c, i) => `[${i + 1}] ${c}`).join("\n")}

Now produce the marketing brief via the brief tool.`;

  return await structuredCall({
    apiKey,
    system: SYSTEM,
    user,
    tool_name: "brief",
    tool_description: "Emit the structured marketing brief.",
    schema: MarketingBrief,
    json_schema: BRIEF_JSON_SCHEMA,
    max_tokens: 1500,
  });
}
