import type { Sandbox } from "@vercel/sandbox";
import type { Caption } from "@cutting-tool/core";
import { renderTextOverlayPng } from "./text-render";

const REEL_W = 1080;
const REEL_H = 1920;

/**
 * Apply Reel-level captions (Timeline.captions) to a fully-concatenated reel.
 * Each caption gets rendered to PNG via @resvg/resvg-js (Vercel Function side),
 * staged into sandbox, then composited via a single filter_complex chain.
 */
export async function applyReelCaptions(opts: {
  sandbox: Sandbox;
  input: string;
  output: string;
  captions: Caption[];
  fontBuffer: Buffer;
}): Promise<void> {
  const { sandbox, input, output, captions, fontBuffer } = opts;
  if (captions.length === 0) {
    const cmd = await sandbox.runCommand("ffmpeg", [
      "-y", "-i", input, "-c", "copy", "-movflags", "+faststart", output,
    ]);
    if (cmd.exitCode !== 0) {
      throw new Error(`copy ${input}: ${(await cmd.stderr()).slice(0, 400)}`);
    }
    return;
  }

  // Pre-render each caption as PNG, stage into sandbox.
  const writes: Array<{ path: string; content: Buffer }> = [];
  const pngPaths: string[] = [];
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i]!;
    const png = await renderTextOverlayPng({
      overlay: {
        kind: "text",
        value: c.text,
        position: c.position,
        style: c.style,
        start_at_s: c.t_in,
        end_at_s: c.t_out,
      },
      fontBuffer,
    });
    const path = `caption-${i}.png`;
    writes.push({ path, content: png });
    pngPaths.push(path);
  }
  await sandbox.writeFiles(writes);

  // Build filter_complex with one overlay per caption.
  const parts: string[] = [];
  let stream = "[0:v]";
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i]!;
    const inputLabel = `[${i + 1}:v]`;
    const scaledLabel = `[c${i}]`;
    const targetW = Math.round(REEL_W * 0.86);
    parts.push(`${inputLabel}scale=${targetW}:-1${scaledLabel}`);
    const last = i === captions.length - 1;
    const outLabel = last ? "[vout]" : `[s${i}]`;
    const xy = positionXY(c.position);
    parts.push(
      `${stream}${scaledLabel}overlay=${xy}:enable='between(t,${c.t_in.toFixed(2)},${c.t_out.toFixed(2)})'${outLabel}`,
    );
    stream = outLabel;
  }
  const filter = parts.join(";");

  const args = ["-y", "-i", input];
  for (const p of pngPaths) args.push("-i", p);
  args.push(
    "-filter_complex", filter,
    "-map", "[vout]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-b:v", "8M",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    output,
  );

  const cmd = await sandbox.runCommand("ffmpeg", args);
  if (cmd.exitCode !== 0) {
    throw new Error(`applyReelCaptions: ${(await cmd.stderr()).slice(0, 600)}`);
  }
  void REEL_H;
}

function positionXY(pos: Caption["position"]): string {
  switch (pos) {
    case "top":
    case "hook":
      return "x=(W-w)/2:y=H*0.10";
    case "center":
      return "x=(W-w)/2:y=(H-h)/2";
    case "bottom":
    case "cta":
      return "x=(W-w)/2:y=H*0.78";
    default: {
      const _exhaustive: never = pos;
      throw new Error(`Unknown caption position: ${_exhaustive}`);
    }
  }
}
