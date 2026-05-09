import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { HIGGSFIELD_BIN } from "../config.js";
import type { Scene, SceneDuration } from "../schemas.js";

export interface GenerateResult {
  job_id?: string;
  result_url: string;
  raw_json: unknown;
}

interface GenerateOpts {
  scene: Scene;
  prevLastFramePng?: string;
  outputMp4: string;
}

export async function generateClip(opts: GenerateOpts): Promise<GenerateResult> {
  const { scene, prevLastFramePng, outputMp4 } = opts;
  const args: string[] = ["generate", "create"];

  if (scene.model === "veo-3.1-fast") {
    args.push("veo3_1");
    args.push("--prompt", scene.prompt);
    args.push("--model", "veo-3-1-fast");
    args.push("--aspect_ratio", "9:16");
    args.push("--duration", String(scene.duration));
    args.push("--quality", "basic");
    if (prevLastFramePng && scene.chain_from_previous) {
      args.push("--input-image", prevLastFramePng);
    }
  } else {
    args.push("seedance_2_0");
    args.push("--prompt", scene.prompt);
    args.push("--aspect_ratio", "9:16");
    args.push("--duration", String(scene.duration));
    args.push("--resolution", "1080p");
    args.push("--mode", "std");
    if (prevLastFramePng && scene.chain_from_previous) {
      args.push("--medias", prevLastFramePng);
    }
  }
  args.push("--wait", "--wait-timeout", "20m", "--json");

  const { stdout } = await execa(HIGGSFIELD_BIN, args, { timeout: 25 * 60_000 });
  const parsed = parseHiggsfieldJson(stdout);
  const url = pickResultUrl(parsed);
  if (!url) {
    throw new Error(
      `higgsfield returned no result URL for scene ${scene.index}. Raw output:\n${stdout.slice(0, 800)}`,
    );
  }

  await fs.mkdir(path.dirname(outputMp4), { recursive: true });
  await downloadToFile(url, outputMp4);

  return {
    job_id: pickJobId(parsed),
    result_url: url,
    raw_json: parsed,
  };
}

export async function getCreditBalance(): Promise<number | null> {
  try {
    const { stdout } = await execa(HIGGSFIELD_BIN, ["account", "--json"], {
      timeout: 30_000,
    });
    const parsed = parseHiggsfieldJson(stdout);
    if (parsed && typeof parsed === "object") {
      const candidates = ["credits", "balance", "credit_balance"];
      for (const k of candidates) {
        const v = (parsed as Record<string, unknown>)[k];
        if (typeof v === "number") return v;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function parseHiggsfieldJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const lastBrace = trimmed.lastIndexOf("}");
    const firstBrace = trimmed.indexOf("{");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function pickResultUrl(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  const flat = ["result_url", "video_url", "url", "output_url", "media_url"];
  for (const k of flat) {
    const v = obj[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  const nestedKeys = ["result", "output", "media", "data", "job"];
  for (const k of nestedKeys) {
    const v = obj[k];
    if (v && typeof v === "object") {
      const url = pickResultUrl(v);
      if (url) return url;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        const url = pickResultUrl(item);
        if (url) return url;
      }
    }
  }
  return undefined;
}

function pickJobId(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  for (const k of ["id", "job_id", "uuid"]) {
    const v = obj[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`download ${url} → ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
}

export function durationCapForModel(_model: Scene["model"]): SceneDuration[] {
  return [4, 6, 8];
}
