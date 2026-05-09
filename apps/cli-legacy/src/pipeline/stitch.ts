import fs from "node:fs/promises";
import path from "node:path";
import { concatDemuxer, normalizeForConcat } from "../runners/ffmpeg.js";
import type { GeneratedScene } from "./generate-scenes.js";

export async function stitchReel(
  scenes: GeneratedScene[],
  runDir: string,
): Promise<string> {
  const stitchDir = path.join(runDir, "stitch");
  await fs.mkdir(stitchDir, { recursive: true });

  const normalized: string[] = [];
  for (const s of scenes) {
    const out = path.join(stitchDir, `norm-${s.scene.index}.mp4`);
    await normalizeForConcat(s.finalClipPath, out);
    normalized.push(out);
  }

  const reelPath = path.join(runDir, "reel.mp4");
  await concatDemuxer(normalized, reelPath, stitchDir);
  return reelPath;
}
