import type { Sandbox } from "@vercel/sandbox";

/**
 * Extract `count` evenly-spaced frames from a video inside Sandbox,
 * read them out as base64 PNGs (suitable for Anthropic vision blocks).
 */
export async function sampleFramesAsBase64(
  sandbox: Sandbox,
  inputPath: string,
  baseName: string,
  count = 3,
): Promise<string[]> {
  // Probe duration to compute frame timestamps.
  const probe = await sandbox.runCommand("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  if (probe.exitCode !== 0) {
    throw new Error(`ffprobe ${inputPath}: ${(await probe.stderr()).slice(0, 400)}`);
  }
  const duration = Number((await probe.stdout()).trim());
  if (!isFinite(duration) || duration <= 0) {
    throw new Error(`Invalid duration for ${inputPath}: ${duration}`);
  }

  const points = Array.from({ length: count }, (_, i) =>
    Math.max(0.05, (duration * (i + 0.5)) / count),
  );

  const out: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const file = `${baseName}-frame-${i + 1}.png`;
    const cmd = await sandbox.runCommand("ffmpeg", [
      "-y",
      "-ss", String(points[i]),
      "-i", inputPath,
      "-vframes", "1",
      "-q:v", "2",
      file,
    ]);
    if (cmd.exitCode !== 0) {
      throw new Error(
        `frame extract ${file}: ${(await cmd.stderr()).slice(0, 400)}`,
      );
    }
    const buf = await sandbox.readFileToBuffer({ path: file });
    if (!buf) throw new Error(`readFileToBuffer empty for ${file}`);
    out.push(Buffer.from(buf).toString("base64"));
  }
  return out;
}
