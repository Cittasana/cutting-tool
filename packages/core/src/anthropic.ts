import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const TAGGING_MODEL = "claude-haiku-4-5-20251001";

export interface StructuredCallOpts<T extends z.ZodTypeAny> {
  apiKey: string;
  model?: string;
  system: string;
  user: string | Anthropic.MessageParam["content"];
  tool_name: string;
  tool_description: string;
  schema: T;
  json_schema: object;
  max_tokens?: number;
}

export async function structuredCall<T extends z.ZodTypeAny>(
  opts: StructuredCallOpts<T>,
): Promise<z.infer<T>> {
  const client = new Anthropic({ apiKey: opts.apiKey });

  const userContent = opts.user;
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: typeof userContent === "string" ? userContent : userContent,
    },
  ];

  const res = await client.messages.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.max_tokens ?? 4096,
    system: opts.system,
    tools: [
      {
        name: opts.tool_name,
        description: opts.tool_description,
        input_schema: opts.json_schema as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: opts.tool_name },
    messages,
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error(
      `structuredCall(${opts.tool_name}): no tool_use block in response`,
    );
  }
  const parsed = opts.schema.safeParse(block.input);
  if (!parsed.success) {
    throw new Error(
      `structuredCall(${opts.tool_name}) schema validation failed: ${parsed.error.message}\nReceived: ${JSON.stringify(block.input).slice(0, 800)}`,
    );
  }
  return parsed.data;
}

export async function imageBlocksFromBase64Pngs(
  base64s: string[],
): Promise<Anthropic.ImageBlockParam[]> {
  return base64s.map((b64) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/png" as const,
      data: b64,
    },
  }));
}
