import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import {
  FFMPEG_BIN,
  FFPROBE_BIN,
  REEL_AUDIO_BITRATE,
  REEL_FPS,
  REEL_HEIGHT,
  REEL_VIDEO_BITRATE,
  REEL_WIDTH,
} from "../config.js";

export async function probeDurationSec(file: string): Promise<number> {
  const { stdout } = await execa(FFPROBE_BIN, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  return Number(stdout.trim());
}

export async function extractLastFrame(input: string, output: string): Promise<void> {
  await execa(FFMPEG_BIN, [
    "-y",
    "-sseof",
    "-0.04",
    "-i",
    input,
    "-vframes",
    "1",
    "-q:v",
    "2",
    output,
  ]);
}

export async function sampleFrames(
  input: string,
  outputDir: string,
  baseName: string,
  count = 3,
): Promise<string[]> {
  await fs.mkdir(outputDir, { recursive: true });
  const duration = await probeDurationSec(input);
  const points = Array.from({ length: count }, (_, i) =>
    Math.max(0.05, (duration * (i + 0.5)) / count),
  );
  const out: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const file = path.join(outputDir, `${baseName}-frame-${i + 1}.png`);
    await execa(FFMPEG_BIN, [
      "-y",
      "-ss",
      String(points[i]),
      "-i",
      input,
      "-vframes",
      "1",
      "-q:v",
      "2",
      file,
    ]);
    out.push(file);
  }
  return out;
}

export async function muxVoiceover(
  videoIn: string,
  audioIn: string,
  output: string,
): Promise<void> {
  await execa(FFMPEG_BIN, [
    "-y",
    "-i",
    videoIn,
    "-i",
    audioIn,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    REEL_AUDIO_BITRATE,
    "-shortest",
    output,
  ]);
}

export async function normalizeForConcat(
  input: string,
  output: string,
): Promise<void> {
  const vf = `scale=${REEL_WIDTH}:${REEL_HEIGHT}:force_original_aspect_ratio=decrease,pad=${REEL_WIDTH}:${REEL_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${REEL_FPS}`;
  await execa(FFMPEG_BIN, [
    "-y",
    "-i",
    input,
    "-vf",
    vf,
    "-c:v",
    "h264_videotoolbox",
    "-b:v",
    REEL_VIDEO_BITRATE,
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-b:a",
    REEL_AUDIO_BITRATE,
    "-movflags",
    "+faststart",
    output,
  ]);
}

export async function concatDemuxer(
  inputs: string[],
  output: string,
  workDir: string,
): Promise<void> {
  await fs.mkdir(workDir, { recursive: true });
  const listFile = path.join(workDir, "concat.txt");
  const lines = inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`);
  await fs.writeFile(listFile, lines.join("\n") + "\n", "utf8");
  await execa(FFMPEG_BIN, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    output,
  ]);
}

export async function ensureSilentAudio(
  input: string,
  output: string,
): Promise<void> {
  await execa(FFMPEG_BIN, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-i",
    input,
    "-shortest",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    REEL_AUDIO_BITRATE,
    "-map",
    "1:v:0",
    "-map",
    "0:a:0",
    output,
  ]);
}

export function escapeDrawtextValue(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}
