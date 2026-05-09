import type { Sandbox } from "@vercel/sandbox";

const REEL_W = 1080;
const REEL_H = 1920;
const REEL_FPS = 30;
const REEL_VBITRATE = "8M";
const REEL_ABITRATE = "192k";

/**
 * Mux a silent video with a generated voiceover. Output replaces video's audio.
 */
export async function muxVoiceover(
  sandbox: Sandbox,
  videoIn: string,
  audioIn: string,
  output: string,
): Promise<void> {
  const cmd = await sandbox.runCommand("ffmpeg", [
    "-y",
    "-i", videoIn,
    "-i", audioIn,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", REEL_ABITRATE,
    "-shortest",
    output,
  ]);
  if (cmd.exitCode !== 0) {
    const stderr = await cmd.stderr();
    throw new Error(`muxVoiceover ${videoIn}: ${stderr.slice(0, 600)}`);
  }
}

/**
 * Normalize a clip's resolution/fps/codec so concat-demuxer can stream-copy it.
 * AL2023 dnf-ffmpeg uses libx264 (no h264_videotoolbox in sandbox CPU).
 */
export async function normalizeForConcat(
  sandbox: Sandbox,
  input: string,
  output: string,
): Promise<void> {
  const vf = `scale=${REEL_W}:${REEL_H}:force_original_aspect_ratio=decrease,pad=${REEL_W}:${REEL_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${REEL_FPS}`;
  const cmd = await sandbox.runCommand("ffmpeg", [
    "-y",
    "-i", input,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-b:v", REEL_VBITRATE,
    "-c:a", "aac",
    "-ar", "48000",
    "-b:a", REEL_ABITRATE,
    "-movflags", "+faststart",
    output,
  ]);
  if (cmd.exitCode !== 0) {
    const stderr = await cmd.stderr();
    throw new Error(`normalizeForConcat ${input}: ${stderr.slice(0, 600)}`);
  }
}

/**
 * Concat a list of normalized clips losslessly via the concat demuxer.
 */
export async function concatDemuxer(
  sandbox: Sandbox,
  inputs: string[],
  output: string,
  workDir: string,
): Promise<void> {
  const listFile = `${workDir}/concat.txt`;
  const lines = inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  await sandbox.writeFiles([{ path: listFile, content: Buffer.from(lines) }]);
  const cmd = await sandbox.runCommand("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-c", "copy",
    "-movflags", "+faststart",
    output,
  ]);
  if (cmd.exitCode !== 0) {
    const stderr = await cmd.stderr();
    throw new Error(`concatDemuxer: ${stderr.slice(0, 600)}`);
  }
}

/**
 * Add a silent track to a video that has none, so concat-demuxer doesn't choke
 * on a/v stream mismatch between scenes.
 */
export async function ensureSilentAudio(
  sandbox: Sandbox,
  input: string,
  output: string,
): Promise<void> {
  const cmd = await sandbox.runCommand("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-i", input,
    "-shortest",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", REEL_ABITRATE,
    "-map", "1:v:0",
    "-map", "0:a:0",
    output,
  ]);
  if (cmd.exitCode !== 0) {
    const stderr = await cmd.stderr();
    throw new Error(`ensureSilentAudio ${input}: ${stderr.slice(0, 600)}`);
  }
}
