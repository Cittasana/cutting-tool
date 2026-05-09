import { parseArgs } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { confirm, select } from "@inquirer/prompts";
import { generateBrief } from "./agents/brief.js";
import { evaluateFinal } from "./agents/final-eval.js";
import { generateStoryboard } from "./agents/storyboard.js";
import { validateAssetsForStoryboard } from "./assets-registry.js";
import {
  FINAL_EVAL_PASS_THRESHOLD,
  OUTPUT_DIR,
} from "./config.js";
import { RunLogger } from "./logger.js";
import { writeArchive } from "./pipeline/archive.js";
import { generateScenes } from "./pipeline/generate-scenes.js";
import { stitchReel } from "./pipeline/stitch.js";
import { sampleFrames } from "./runners/ffmpeg.js";
import { getCreditBalance } from "./runners/higgsfield.js";
import { collectIconNames } from "./runners/overlay.js";
import { pickVoiceId } from "./runners/elevenlabs.js";
import {
  RunConfig,
  type Language,
  validateStoryboard,
} from "./schemas.js";
import { scrape } from "./scraper.js";

async function main() {
  const args = parseArgs({
    options: {
      url: { type: "string" },
      length: { type: "string" },
      slug: { type: "string" },
      language: { type: "string" },
      "font-de": { type: "string" },
      "font-en": { type: "string" },
      "voice-id": { type: "string" },
      "auto-accept-storyboard": { type: "boolean", default: false },
      "no-scene-eval": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (args.values.help || !args.values.url) {
    printHelp();
    process.exit(args.values.help ? 0 : 1);
  }

  const lengthNum = Number(args.values.length ?? "30");
  if (lengthNum !== 30 && lengthNum !== 60) {
    fail(`--length must be 30 or 60, got ${args.values.length}`);
  }
  const length_seconds = lengthNum as 30 | 60;

  const slug = (args.values.slug ?? new URL(args.values.url!).hostname.replace(/[^a-z0-9]+/gi, "-").toLowerCase()).slice(0, 60);

  const cfg = RunConfig.parse({
    url: args.values.url,
    length_seconds,
    slug,
    language: (args.values.language ?? "de") as Language,
    font_de: args.values["font-de"],
    font_en: args.values["font-en"],
    auto_accept_storyboard: args.values["auto-accept-storyboard"],
    scene_eval_enabled: !args.values["no-scene-eval"],
    voice_id: args.values["voice-id"],
  });

  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "-")
    .slice(0, 13);
  const runDir = path.join(OUTPUT_DIR, cfg.slug, ts);
  await fs.mkdir(runDir, { recursive: true });
  const logger = new RunLogger(runDir);

  logger.info("run started", { runDir, cfg });
  const credits = await getCreditBalance();
  if (credits != null) logger.info(`higgsfield credit balance: ${credits}`);

  logger.info("scraping product context");
  const productContext = await scrape(cfg.url);
  logger.info("scraped", {
    title: productContext.title,
    chunks: productContext.copy_chunks.length,
    detected_language: productContext.detected_language,
  });

  if (productContext.copy_chunks.length < 5) {
    logger.warn("thin product context — relying on brief agent to brainstorm");
  }

  logger.info("generating marketing brief");
  const brief = await generateBrief(productContext, cfg.length_seconds);
  brief.language = cfg.language;
  logger.info("brief", brief);

  logger.info("generating storyboard");
  const storyboard = await generateStoryboard(brief, cfg.length_seconds);
  const sbErrors = validateStoryboard(storyboard);
  if (sbErrors.length) {
    throw new Error(`Storyboard validation errors:\n${sbErrors.join("\n")}`);
  }
  logger.info(`storyboard: ${storyboard.scenes.length} scenes, ${storyboard.total_duration_seconds}s`);

  validateAssetsForStoryboard(
    cfg.language,
    cfg.font_de,
    cfg.font_en,
    collectIconNames(storyboard.scenes),
  );
  logger.info("assets validated");

  if (!cfg.auto_accept_storyboard) {
    console.log("\nStoryboard preview:");
    for (const s of storyboard.scenes) {
      console.log(
        `  ${s.index}. [${s.model}] ${s.duration}s ${s.kind}${s.chain_from_previous ? " (chained)" : ""} — ${s.prompt.slice(0, 110)}…`,
      );
      if (s.voiceover_text) console.log(`     VO: ${s.voiceover_text}`);
      if (s.overlays.length) {
        console.log(
          `     overlays: ${s.overlays.map((o) => (o.kind === "text" ? `"${o.value}" @ ${o.position}` : `${o.name} @ ${o.position}`)).join(", ")}`,
        );
      }
    }
    const ok = await confirm({
      message: "Proceed with this storyboard?",
      default: true,
    });
    if (!ok) {
      logger.info("user aborted at storyboard review");
      process.exit(0);
    }
  }

  const voiceId = pickVoiceId(brief, cfg.voice_id);
  logger.info(`voice id: ${voiceId}`);

  logger.info("generating scenes");
  const scenes = await generateScenes({
    storyboard,
    brief,
    runDir,
    language: cfg.language,
    voiceId,
    sceneEvalEnabled: cfg.scene_eval_enabled,
    logger,
  });
  logger.info(`${scenes.length} scenes generated`);

  logger.info("stitching reel");
  const reelPath = await stitchReel(scenes, runDir);
  logger.info(`reel at ${reelPath}`);

  logger.info("running final evaluation");
  const reelFrames = await sampleFrames(
    reelPath,
    path.join(runDir, "eval-frames"),
    "reel",
    Math.min(8, Math.ceil(cfg.length_seconds / 4)),
  );
  const veoTranscript = scenes
    .filter((s) => !s.scene.uses_native_audio && s.scene.voiceover_text)
    .map((s) => `[scene ${s.scene.index}] ${s.scene.voiceover_text}`)
    .join("\n");
  const finalReport = await evaluateFinal(reelFrames, brief, storyboard, veoTranscript);
  logger.info("final eval", finalReport);

  await writeArchive(
    {
      runConfig: cfg,
      productContext,
      brief,
      storyboard,
      scenes,
      finalReport,
    },
    runDir,
  );

  console.log("\n=== Final evaluation ===");
  console.log(`verdict: ${finalReport.one_line_verdict}`);
  console.log(
    `scores: hook=${finalReport.hook_strength} clarity=${finalReport.message_clarity} cohesion=${finalReport.visual_cohesion} cta=${finalReport.cta_effectiveness} pacing=${finalReport.pacing} typography=${finalReport.typography_quality}`,
  );
  if (finalReport.issues.length) {
    console.log("issues:");
    for (const i of finalReport.issues) {
      console.log(`  [${i.severity}] ${i.description} → ${i.fix_suggestion}`);
    }
  }

  if (
    !finalReport.pass ||
    finalReport.typography_quality < FINAL_EVAL_PASS_THRESHOLD
  ) {
    if (cfg.auto_accept_storyboard) {
      logger.warn("final eval did not pass, but auto-accept enabled — saving anyway");
    } else {
      const action = await select({
        message: "Final evaluation did not pass. What now?",
        choices: [
          { value: "save", name: "Save anyway" },
          { value: "abort", name: "Abort (delete run)" },
        ],
      });
      if (action === "abort") {
        await fs.rm(runDir, { recursive: true, force: true });
        process.exit(2);
      }
    }
  }

  console.log(`\n✓ saved to: ${reelPath}`);
}

function printHelp(): void {
  console.log(`Usage:
  pnpm start --url <product-url> --length 30|60 [options]

Options:
  --url URL                       Product/page URL to base the reel on (required)
  --length 30|60                  Total reel length in seconds (default: 30)
  --slug NAME                     Output folder slug (default: from URL hostname)
  --language de|en                Content language (default: de)
  --font-de NAME                  Override DE font (default: Inter-Regular)
  --font-en NAME                  Override EN font (default: Inter-Regular)
  --voice-id ID                   Override ElevenLabs voice ID
  --auto-accept-storyboard        Skip the interactive storyboard review
  --no-scene-eval                 Skip per-scene QC (cost saver, less safe)
  --help                          Show this help`);
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("\n✗ run failed:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
