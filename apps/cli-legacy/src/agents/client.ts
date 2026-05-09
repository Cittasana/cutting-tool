import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ANTHROPIC_MODEL, getAnthropicApiKey } from "../config.js";

let _anthropic: Anthropic | undefined;
function getClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: getAnthropicApiKey() });
  return _anthropic;
}

interface StructuredCallOpts<T extends z.ZodTypeAny> {
  system: string;
  user: Anthropic.MessageParam["content"];
  tool_name: string;
  tool_description: string;
  schema: T;
  json_schema: object;
  max_tokens?: number;
}

export async function structuredCall<T extends z.ZodTypeAny>(
  opts: StructuredCallOpts<T>,
): Promise<z.infer<T>> {
  const userContent = opts.user;
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: typeof userContent === "string" ? userContent : userContent,
    },
  ];

  const res = await getClient().messages.create({
    model: ANTHROPIC_MODEL,
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

export async function imageBlocksFromPaths(
  paths: string[],
): Promise<Anthropic.ImageBlockParam[]> {
  const fs = await import("node:fs/promises");
  const blocks: Anthropic.ImageBlockParam[] = [];
  for (const p of paths) {
    const buf = await fs.readFile(p);
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
        data: buf.toString("base64"),
      },
    });
  }
  return blocks;
}
