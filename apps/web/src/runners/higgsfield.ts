import type { Sandbox } from "@vercel/sandbox";
import type { Scene } from "@cutting-tool/core";

export interface GenerateSceneOpts {
  sandbox: Sandbox;
  scene: Scene;
  hfCredentials: string;          // KEY_ID:KEY_SECRET (V2)
  prevLastFramePath?: string;     // path inside sandbox (for chained scenes)
  outputPath: string;             // where the MP4 lands inside sandbox
  brandStyleDescription?: string; // prepended before scene-specific prompt
}

const NEGATIVE_TEXT_BLOCK =
  "No on-screen text, no captions, no subtitles, no logos, no UI elements, no watermarks. Pure cinematic footage only.";

function composeScenePrompt(scene: Scene, brandStyle: string | undefined): string {
  // Storyboard agent already prepends visual_style + appends the negative-text block.
  // We splice the brand style description in front of the scene's existing prompt
  // (above the visual_style line) without breaking the trailing negative directive.
  if (!brandStyle) return scene.prompt;
  // Avoid double-injection if the brand style already happens to be in the prompt.
  if (scene.prompt.includes(brandStyle)) return scene.prompt;
  return `[BRAND_LOOK] ${brandStyle}\n\n${scene.prompt}`;
}

interface HiggsfieldJsonResult {
  result_url?: string;
  video_url?: string;
  url?: string;
  output_url?: string;
  media_url?: string;
  result?: HiggsfieldJsonResult | HiggsfieldJsonResult[];
  output?: HiggsfieldJsonResult | HiggsfieldJsonResult[];
  media?: HiggsfieldJsonResult | HiggsfieldJsonResult[];
  data?: HiggsfieldJsonResult | HiggsfieldJsonResult[];
  job?: HiggsfieldJsonResult | HiggsfieldJsonResult[];
  id?: string;
  job_id?: string;
  uuid?: string;
}

/**
 * Generate a single scene's clip via the higgsfield CLI inside Sandbox.
 *
 * Resolves to the URL of the produced MP4 once the CLI completes (--wait).
 * Caller is responsible for downloading it into the sandbox at `outputPath`.
 */
export async function generateScene(opts: GenerateSceneOpts): Promise<{ url: string; jobId?: string }> {
  const { sandbox, scene, hfCredentials, prevLastFramePath, brandStyleDescription } = opts;
  const prompt = composeScenePrompt(scene, brandStyleDescription);
  const args: string[] = ["generate", "create"];

  if (scene.model === "veo-3.1-fast") {
    args.push("veo3_1");
    args.push("--prompt", prompt);
    args.push("--model", "veo-3-1-fast");
    args.push("--aspect_ratio", "9:16");
    args.push("--duration", String(scene.duration));
    args.push("--quality", "basic");
    if (prevLastFramePath && scene.chain_from_previous) {
      args.push("--input-image", prevLastFramePath);
    }
  } else {
    args.push("seedance_2_0");
    args.push("--prompt", prompt);
    args.push("--aspect_ratio", "9:16");
    args.push("--duration", String(scene.duration));
    args.push("--resolution", "1080p");
    args.push("--mode", "std");
    if (prevLastFramePath && scene.chain_from_previous) {
      args.push("--medias", prevLastFramePath);
    }
  }
  // Reaffirm negative directive at the very end (storyboard agent already
  // adds it, but if a brand style block sneaks in extra wording we keep
  // the no-text rule loud).
  if (!prompt.toLowerCase().includes("no on-screen text")) {
    const idx = args.lastIndexOf("--prompt") + 1;
    args[idx] = `${args[idx]}\n\n${NEGATIVE_TEXT_BLOCK}`;
  }
  args.push("--wait", "--wait-timeout", "20m", "--json");

  const cmd = await sandbox.runCommand({
    cmd: "hf",
    args,
    env: { HF_CREDENTIALS: hfCredentials },
  });
  if (cmd.exitCode !== 0) {
    const stderr = await cmd.stderr();
    throw new Error(
      `hf generate scene ${scene.index} failed (exit ${cmd.exitCode}): ${stderr.slice(0, 800)}`,
    );
  }
  const stdout = await cmd.stdout();
  const parsed = parseJson(stdout);
  const url = pickResultUrl(parsed);
  if (!url) {
    throw new Error(
      `hf generate scene ${scene.index}: no result URL in output. Raw: ${stdout.slice(0, 800)}`,
    );
  }
  return { url, jobId: pickJobId(parsed) };
}

/**
 * Download a URL into the sandbox at `outputPath`.
 */
export async function downloadIntoSandbox(
  sandbox: Sandbox,
  url: string,
  outputPath: string,
): Promise<void> {
  const cmd = await sandbox.runCommand("curl", ["-fsSL", "-o", outputPath, url]);
  if (cmd.exitCode !== 0) {
    const stderr = await cmd.stderr();
    throw new Error(`curl ${url} → ${outputPath} failed: ${stderr.slice(0, 500)}`);
  }
}

/**
 * Extract last frame of a clip into a PNG (used to chain into the next scene).
 */
export async function extractLastFrame(
  sandbox: Sandbox,
  inputPath: string,
  outputPng: string,
): Promise<void> {
  const cmd = await sandbox.runCommand("ffmpeg", [
    "-y",
    "-sseof", "-0.04",
    "-i", inputPath,
    "-vframes", "1",
    "-q:v", "2",
    outputPng,
  ]);
  if (cmd.exitCode !== 0) {
    const stderr = await cmd.stderr();
    throw new Error(`extractLastFrame ${inputPath}: ${stderr.slice(0, 500)}`);
  }
}

function parseJson(stdout: string): HiggsfieldJsonResult | null {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as HiggsfieldJsonResult;
  } catch {
    const last = trimmed.lastIndexOf("}");
    const first = trimmed.indexOf("{");
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1)) as HiggsfieldJsonResult;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function pickResultUrl(parsed: HiggsfieldJsonResult | null): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const flat = ["result_url", "video_url", "url", "output_url", "media_url"] as const;
  for (const k of flat) {
    const v = parsed[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  for (const k of ["result", "output", "media", "data", "job"] as const) {
    const v = parsed[k];
    if (v && typeof v === "object") {
      if (Array.isArray(v)) {
        for (const item of v) {
          const url = pickResultUrl(item);
          if (url) return url;
        }
      } else {
        const url = pickResultUrl(v);
        if (url) return url;
      }
    }
  }
  return undefined;
}

function pickJobId(parsed: HiggsfieldJsonResult | null): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  for (const k of ["id", "job_id", "uuid"] as const) {
    const v = parsed[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}
