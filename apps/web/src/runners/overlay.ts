import type { Sandbox } from "@vercel/sandbox";
import type { IconOverlay, Scene, TextOverlay } from "@cutting-tool/core";

const REEL_W = 1080;
const REEL_H = 1920;

interface PreparedOverlay {
  pngPath: string;
  start: number;
  end: number;
  position: TextOverlay["position"] | IconOverlay["position"];
  isText: boolean;
  iconWidthPx?: number;
}

/**
 * Apply text + icon overlays to a clip inside Sandbox. Text PNGs must
 * already be staged at the given paths (pre-rendered in a Vercel Function
 * via @resvg/resvg-js). Icon PNGs are likewise expected to be present
 * (downloaded from brand-defaults or project assets).
 */
export async function applyOverlays(opts: {
  sandbox: Sandbox;
  input: string;
  output: string;
  scene: Scene;
  textOverlayPaths: Record<number, string>;     // overlay-index → png path
  iconOverlayPaths: Record<number, string>;     // overlay-index → png path
}): Promise<void> {
  const { sandbox, input, output, scene, textOverlayPaths, iconOverlayPaths } = opts;
  if (scene.overlays.length === 0) {
    const cmd = await sandbox.runCommand("ffmpeg", [
      "-y",
      "-i", input,
      "-c", "copy",
      "-movflags", "+faststart",
      output,
    ]);
    if (cmd.exitCode !== 0) {
      throw new Error(`copy ${input}: ${(await cmd.stderr()).slice(0, 400)}`);
    }
    return;
  }

  const prepared: PreparedOverlay[] = scene.overlays.map((ov, i) => {
    if (ov.kind === "text") {
      return {
        pngPath: textOverlayPaths[i]!,
        start: ov.start_at_s,
        end: ov.end_at_s,
        position: ov.position,
        isText: true,
      };
    }
    return {
      pngPath: iconOverlayPaths[i]!,
      start: ov.start_at_s,
      end: ov.end_at_s,
      position: ov.position,
      isText: false,
      iconWidthPx: Math.round((REEL_H * ov.size_pct) / 100),
    };
  });

  if (prepared.some((p) => !p.pngPath)) {
    throw new Error(`scene ${scene.index}: missing overlay PNG paths`);
  }

  // Build filter_complex: each overlay scales then overlays with timing.
  const filterParts: string[] = [];
  let stream = "[0:v]";
  for (let i = 0; i < prepared.length; i++) {
    const ov = prepared[i]!;
    const inputLabel = `[${i + 1}:v]`;
    const scaledLabel = `[ov${i}]`;
    if (ov.isText) {
      const targetW = Math.round(REEL_W * 0.86);
      filterParts.push(`${inputLabel}scale=${targetW}:-1${scaledLabel}`);
    } else {
      filterParts.push(`${inputLabel}scale=${ov.iconWidthPx}:-1${scaledLabel}`);
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

  const args: string[] = ["-y", "-i", input];
  for (const ov of prepared) args.push("-i", ov.pngPath);
  args.push(
    "-filter_complex", filterComplex,
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
    throw new Error(`applyOverlays scene ${scene.index}: ${(await cmd.stderr()).slice(0, 600)}`);
  }
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
  const margin = Math.round(REEL_W * 0.06);
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
