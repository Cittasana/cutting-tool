import fs from "node:fs/promises";
import path from "node:path";
import type {
  EvaluationReport,
  MarketingBrief,
  ProductContext,
  RunConfig,
  Storyboard,
} from "../schemas.js";
import type { GeneratedScene } from "./generate-scenes.js";

export interface ArchiveBundle {
  runConfig: RunConfig;
  productContext: ProductContext;
  brief: MarketingBrief;
  storyboard: Storyboard;
  scenes: GeneratedScene[];
  finalReport: EvaluationReport;
}

export async function writeArchive(
  bundle: ArchiveBundle,
  runDir: string,
): Promise<void> {
  await Promise.all([
    write(path.join(runDir, "run-config.json"), bundle.runConfig),
    write(path.join(runDir, "product-context.json"), bundle.productContext),
    write(path.join(runDir, "brief.json"), bundle.brief),
    write(path.join(runDir, "storyboard.json"), bundle.storyboard),
    write(path.join(runDir, "eval.json"), bundle.finalReport),
    write(
      path.join(runDir, "scenes-index.json"),
      bundle.scenes.map((s) => ({
        index: s.scene.index,
        kind: s.scene.kind,
        model: s.scene.model,
        duration: s.scene.duration,
        retries: s.retries,
        rawClip: path.basename(s.rawClipPath),
        finalClip: path.basename(s.finalClipPath),
        voiceover: s.voiceoverPath ? path.basename(s.voiceoverPath) : null,
        footageEval: s.footageEval,
        overlayEval: s.overlayEval,
      })),
    ),
  ]);
}

async function write(file: string, data: unknown): Promise<void> {
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}
