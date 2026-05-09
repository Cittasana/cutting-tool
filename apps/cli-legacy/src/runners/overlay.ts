import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import {
  FFMPEG_BIN,
  REEL_AUDIO_BITRATE,
  REEL_HEIGHT,
  REEL_VIDEO_BITRATE,
  REEL_WIDTH,
} from "../config.js";
import {
  pickIconSizePx,
  resolveFont,
  resolveIcon,
  type FontEntry,
} from "../assets-registry.js";
import type {
  IconOverlay,
  Language,
  Scene,
  TextOverlay,
} from "../schemas.js";
import { renderTextPng } from "./text-renderer.js";

interface ApplyOverlaysOpts {
  input: string;
  output: string;
  scene: Scene;
  language: Language;
  workDir?: string;
  font?: FontEntry;
}

interface PreparedOverlay {
  pngPath: string;
  start: number;
  end: number;
  position: TextOverlay["position"] | IconOverlay["position"];
  isText: boolean;
  targetWidthPx?: number;
}

export async function applyOverlays(opts: ApplyOverlaysOpts): Promise<void> {
  const { input, output, scene, language } = opts;
  const font = opts.font ?? resolveFont(language);

  if (scene.overlays.length === 0) {
    await execa(FFMPEG_BIN, [
      "-y",
      "-i",
      input,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ]);
    return;
  }

  const workDir =
    opts.workDir ?? path.join(path.dirname(output), `overlay-tmp-${scene.index}`);
  await fs.mkdir(workDir, { recursive: true });

  const prepared: PreparedOverlay[] = [];
  let textIdx = 0;
  let iconIdx = 0;
  for (const ov of scene.overlays) {
    if (ov.kind === "text") {
      const png = path.join(workDir, `text-${textIdx++}.png`);
      await renderTextPng({ overlay: ov, font, output: png });
      prepared.push({
        pngPath: png,
        start: ov.start_at_s,
        end: ov.end_at_s,
        position: ov.position,
        isText: true,
      });
    } else {
      const entry = resolveIcon(ov.name);
      const sizePx = pickIconSizePx(REEL_HEIGHT, ov.size_pct);
      const targetPx = Math.round((REEL_HEIGHT * ov.size_pct) / 100);
      prepared.push({
        pngPath: entry.paths[sizePx],
        start: ov.start_at_s,
        end: ov.end_at_s,
        position: ov.position,
        isText: false,
        targetWidthPx: targetPx,
      });
      iconIdx++;
    }
  }

  const filterParts: string[] = [];
  let stream = "[0:v]";
  for (let i = 0; i < prepared.length; i++) {
    const ov = prepared[i]!;
    const inputLabel = `[${i + 1}:v]`;
    const scaledLabel = `[ov${i}]`;
    if (ov.isText) {
      const targetW = Math.round(REEL_WIDTH * 0.86);
      filterParts.push(`${inputLabel}scale=${targetW}:-1${scaledLabel}`);
    } else {
      filterParts.push(`${inputLabel}scale=${ov.targetWidthPx}:-1${scaledLabel}`);
    }
    const outLabel = i === prepared.length - 1 ? "[vout]" : `[s${i}]`;
    const xy = ov.isText
      ? textXY(ov.position as TextOverlay["position"])
      : iconXY(ov.position as IconOverlay["position"]);
    filterParts.push(
      `${stream}${scaledLabel}overlay=${xy}:enable='between(t,${ov.start.toFixed(2)},${ov.end.toFixed(2)})'${outLabel}`,
    );
    stream = outLabel;
  }
  const filterComplex = filterParts.join(";");

  const args = ["-y", "-i", input];
  for (const ov of prepared) args.push("-i", ov.pngPath);
  args.push(
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-map",
    "0:a?",
    "-c:v",
    "h264_videotoolbox",
    "-b:v",
    REEL_VIDEO_BITRATE,
    "-c:a",
    "aac",
    "-b:a",
    REEL_AUDIO_BITRATE,
    "-movflags",
    "+faststart",
    output,
  );

  await execa(FFMPEG_BIN, args);
}

function textXY(position: TextOverlay["position"]): string {
  switch (position) {
    case "top":
    case "hook":
      return "x=(W-w)/2:y=H*0.10";
    case "center":
      return "x=(W-w)/2:y=(H-h)/2";
    case "bottom":
    case "cta":
      return "x=(W-w)/2:y=H*0.78";
    default: {
      const _exhaustive: never = position;
      throw new Error(`Unknown text position: ${_exhaustive}`);
    }
  }
}

function iconXY(position: IconOverlay["position"]): string {
  const margin = Math.round(REEL_WIDTH * 0.06);
  switch (position) {
    case "top-left":
      return `x=${margin}:y=${margin}`;
    case "top-right":
      return `x=W-w-${margin}:y=${margin}`;
    case "bottom-left":
      return `x=${margin}:y=H-h-${margin}`;
    case "bottom-right":
      return `x=W-w-${margin}:y=H-h-${margin}`;
    case "center":
      return `x=(W-w)/2:y=(H-h)/2`;
    default: {
      const _exhaustive: never = position;
      throw new Error(`Unknown icon position: ${_exhaustive}`);
    }
  }
}

export function collectIconNames(scenes: Scene[]): string[] {
  const set = new Set<string>();
  for (const s of scenes) {
    for (const ov of s.overlays) {
      if (ov.kind === "icon") set.add(ov.name);
    }
  }
  return [...set];
}

export function deriveOverlayPath(rawPath: string): string {
  const parsed = path.parse(rawPath);
  return path.join(parsed.dir, `${parsed.name}.overlaid${parsed.ext}`);
}
