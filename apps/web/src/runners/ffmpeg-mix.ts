import type { Sandbox } from "@vercel/sandbox";

/**
 * Mix background music under an existing video's audio track with sidechain
 * compression so VO ducks the music. Music is looped/cut to match video duration,
 * volume defaults to -14 dB so VO sits clearly on top.
 */
export async function mixBackgroundMusic(
  sandbox: Sandbox,
  videoIn: string,
  musicIn: string,
  output: string,
  opts: { musicVolumeDb?: number; duckThresholdDb?: number; duckRatio?: number } = {},
): Promise<void> {
  const vol = opts.musicVolumeDb ?? -14;
  const threshold = opts.duckThresholdDb ?? -25;
  const ratio = opts.duckRatio ?? 8;

  // Filter graph:
  //   [0:a] -> labeled "vo" (the original VO/dialog track)
  //   [1:a] -> apply volume + sidechain compress against "vo" -> "ducked"
  //   amix [vo, ducked] -> stereo
  // Music is auto-looped via -stream_loop -1 + -t.
  const filter = [
    "[1:a]aloop=loop=-1:size=2147483647[ml]",
    `[ml]volume=${vol}dB[mv]`,
    `[mv][0:a]sidechaincompress=threshold=${dbToLinear(threshold)}:ratio=${ratio}:attack=20:release=250[ducked]`,
    "[0:a][ducked]amix=inputs=2:duration=first:dropout_transition=0[aout]",
  ].join(";");

  const cmd = await sandbox.runCommand("ffmpeg", [
    "-y",
    "-i", videoIn,
    "-stream_loop", "-1",
    "-i", musicIn,
    "-filter_complex", filter,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    output,
  ]);
  if (cmd.exitCode !== 0) {
    throw new Error(`mixBackgroundMusic: ${(await cmd.stderr()).slice(0, 600)}`);
  }
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}
