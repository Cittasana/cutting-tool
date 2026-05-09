import type { Sandbox } from "@vercel/sandbox";
import type { TimelineEntry } from "@cutting-tool/core";

const REEL_W = 1080;
const REEL_H = 1920;
const REEL_FPS = 30;

/**
 * Trim a source clip to [src_in, src_out] and reframe to 9:16 portrait.
 *
 * Reframe modes:
 *   - "center" (default): centered crop preserving height
 *   - "subject": anchor_xy = (relative x, relative y) ∈ [0,1] anchors the crop window
 *   - "manual": same as subject; anchor_xy is required.
 *
 * Output is libx264 + AAC, ready for concat-demuxer normalization.
 */
export async function trimAndReframe(
  sandbox: Sandbox,
  sourcePath: string,
  entry: TimelineEntry,
  outputPath: string,
): Promise<void> {
  const dur = entry.src_out - entry.src_in;
  if (dur <= 0) throw new Error(`invalid src window for ${sourcePath}`);

  const reframe = entry.reframe?.mode ?? "center";
  const zoom = entry.reframe?.zoom ?? 1;
  const ax = entry.reframe?.anchor_xy?.[0] ?? 0.5;
  const ay = entry.reframe?.anchor_xy?.[1] ?? 0.5;

  // Strategy: scale source so its SHORTER dim covers the target * zoom, then
  // crop to REEL_W × REEL_H around the anchor point.
  // Equivalent to scale=-1:H + crop=W:H:x:y for portrait targets where source
  // is typically landscape.
  // ffmpeg expression: w/h sized so the longest covers, then crop.
  // For simplicity: scale to cover, then crop with anchor.
  const scaleExpr = `scale=w='if(gt(a,${REEL_W}/${REEL_H}),-2,${Math.round(REEL_W * zoom)})':h='if(gt(a,${REEL_W}/${REEL_H}),${Math.round(REEL_H * zoom)},-2)'`;
  // Anchor expressions inside crop: x = anchor_x * (iw - W), y = anchor_y * (ih - H)
  const cropExpr = `crop=${REEL_W}:${REEL_H}:x='max(0,min(iw-${REEL_W},(iw-${REEL_W})*${ax.toFixed(3)}))':y='max(0,min(ih-${REEL_H},(ih-${REEL_H})*${ay.toFixed(3)}))'`;

  const vf = [scaleExpr, cropExpr, "setsar=1", `fps=${REEL_FPS}`].join(",");
  void reframe; // mode is currently informational; actual behavior driven by anchor_xy

  const cmd = await sandbox.runCommand("ffmpeg", [
    "-y",
    "-ss", entry.src_in.toFixed(3),
    "-i", sourcePath,
    "-t", dur.toFixed(3),
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-b:v", "8M",
    "-c:a", "aac",
    "-ar", "48000",
    "-b:a", "192k",
    "-movflags", "+faststart",
    outputPath,
  ]);
  if (cmd.exitCode !== 0) {
    throw new Error(`trimAndReframe ${sourcePath}: ${(await cmd.stderr()).slice(0, 600)}`);
  }
}

/**
 * Make a single-frame image into a still video at REEL_FPS for the entry's
 * duration so concat-demuxer treats it like any other clip.
 */
export async function imageToStillVideo(
  sandbox: Sandbox,
  imagePath: string,
  durationSec: number,
  outputPath: string,
): Promise<void> {
  const cmd = await sandbox.runCommand("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-t", durationSec.toFixed(3),
    "-vf",
    `scale=w='if(gt(a,${REEL_W}/${REEL_H}),-2,${REEL_W})':h='if(gt(a,${REEL_W}/${REEL_H}),${REEL_H},-2)',crop=${REEL_W}:${REEL_H}:(iw-${REEL_W})/2:(ih-${REEL_H})/2,setsar=1,fps=${REEL_FPS}`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-b:v", "8M",
    "-c:a", "aac",
    "-ar", "48000",
    "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    outputPath,
  ]);
  if (cmd.exitCode !== 0) {
    throw new Error(`imageToStillVideo ${imagePath}: ${(await cmd.stderr()).slice(0, 600)}`);
  }
}
