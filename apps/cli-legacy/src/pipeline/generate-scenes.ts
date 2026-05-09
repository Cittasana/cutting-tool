import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_RETRIES_PER_SCENE,
  MAX_SCENE_RETRIES_PER_RUN,
} from "../config.js";
import { evaluateFootage, evaluateOverlays } from "../agents/scene-eval.js";
import {
  extractLastFrame,
  muxVoiceover,
  sampleFrames,
} from "../runners/ffmpeg.js";
import { generateClip } from "../runners/higgsfield.js";
import { applyOverlays } from "../runners/overlay.js";
import { synthesizeVoiceover } from "../runners/elevenlabs.js";
import type {
  Language,
  MarketingBrief,
  Scene,
  SceneEval,
  Storyboard,
} from "../schemas.js";
import type { RunLogger } from "../logger.js";

export interface GeneratedScene {
  scene: Scene;
  rawClipPath: string;
  finalClipPath: string;
  voiceoverPath?: string;
  lastFramePath: string;
  footageEval: SceneEval;
  overlayEval: SceneEval;
  retries: number;
}

interface GenerateScenesOpts {
  storyboard: Storyboard;
  brief: MarketingBrief;
  runDir: string;
  language: Language;
  voiceId: string;
  sceneEvalEnabled: boolean;
  logger: RunLogger;
}

export async function generateScenes(
  opts: GenerateScenesOpts,
): Promise<GeneratedScene[]> {
  const { storyboard, brief, runDir, language, voiceId, sceneEvalEnabled, logger } = opts;
  const rawDir = path.join(runDir, "raw");
  const voDir = path.join(runDir, "voiceover");
  const evalDir = path.join(runDir, "eval-frames");
  await Promise.all([
    fs.mkdir(rawDir, { recursive: true }),
    fs.mkdir(voDir, { recursive: true }),
    fs.mkdir(evalDir, { recursive: true }),
  ]);

  const out: GeneratedScene[] = [];
  let runRetries = 0;
  let prevLastFrame: string | undefined;

  for (const scene of storyboard.scenes) {
    logger.info(`scene ${scene.index}: starting`, { model: scene.model, duration: scene.duration });

    let rawClipPath = path.join(rawDir, `scene-${scene.index}.mp4`);
    let footageEval: SceneEval | undefined;
    let attempt = 0;
    let activePrompt = scene.prompt;
    let scenePassed = false;

    while (attempt <= MAX_RETRIES_PER_SCENE && !scenePassed) {
      const usePrev = scene.chain_from_previous && prevLastFrame ? prevLastFrame : undefined;
      const sceneForGen: Scene = { ...scene, prompt: activePrompt };
      logger.info(`scene ${scene.index}: generate attempt ${attempt + 1}`, { chain: !!usePrev });
      await generateClip({
        scene: sceneForGen,
        prevLastFramePng: usePrev,
        outputMp4: rawClipPath,
      });

      if (!sceneEvalEnabled) {
        scenePassed = true;
        break;
      }

      const frames = await sampleFrames(
        rawClipPath,
        evalDir,
        `s${scene.index}-a${attempt + 1}`,
        3,
      );
      footageEval = await evaluateFootage(scene, brief, frames);
      logger.info(`scene ${scene.index}: footage eval`, footageEval);

      if (footageEval.pass) {
        scenePassed = true;
        break;
      }

      attempt++;
      runRetries++;
      if (runRetries > MAX_SCENE_RETRIES_PER_RUN) {
        throw new Error(
          `Run exceeded MAX_SCENE_RETRIES_PER_RUN (${MAX_SCENE_RETRIES_PER_RUN}). Last scene ${scene.index} eval: ${JSON.stringify(footageEval)}`,
        );
      }
      const hint = footageEval.prompt_revision_hint ?? "";
      const negText = footageEval.has_unwanted_text
        ? " ABSOLUTELY NO ON-SCREEN TEXT, NO CAPTIONS, NO SIGNS, NO LOGOS, NO WATERMARKS. Pure cinematic footage only — any visible writing or graphics is a hard failure."
        : "";
      activePrompt = `${scene.prompt}\n\nDirector note: ${hint}${negText}`;
    }

    if (!scenePassed && sceneEvalEnabled) {
      throw new Error(
        `Scene ${scene.index} failed after ${MAX_RETRIES_PER_SCENE + 1} attempts. Eval: ${JSON.stringify(footageEval)}`,
      );
    }

    const lastFramePath = path.join(rawDir, `scene-${scene.index}.last.png`);
    await extractLastFrame(rawClipPath, lastFramePath);
    prevLastFrame = lastFramePath;

    let withAudioPath = rawClipPath;
    let voiceoverPath: string | undefined;
    if (!scene.uses_native_audio && scene.voiceover_text.trim()) {
      voiceoverPath = path.join(voDir, `scene-${scene.index}.mp3`);
      logger.info(`scene ${scene.index}: synthesizing voiceover`);
      await synthesizeVoiceover(scene.voiceover_text, voiceId, voiceoverPath);
      withAudioPath = path.join(rawDir, `scene-${scene.index}.audio.mp4`);
      await muxVoiceover(rawClipPath, voiceoverPath, withAudioPath);
    }

    const overlaidPath = path.join(rawDir, `scene-${scene.index}.final.mp4`);
    await applyOverlays({
      input: withAudioPath,
      output: overlaidPath,
      scene,
      language,
    });

    let overlayEval: SceneEval;
    if (scene.overlays.length === 0 || !sceneEvalEnabled) {
      overlayEval = synthesizePassEval(scene.index);
    } else {
      const frames = await sampleFrames(
        overlaidPath,
        evalDir,
        `s${scene.index}-overlay`,
        3,
      );
      overlayEval = await evaluateOverlays(scene, frames);
      logger.info(`scene ${scene.index}: overlay eval`, overlayEval);
    }

    out.push({
      scene,
      rawClipPath,
      finalClipPath: overlaidPath,
      voiceoverPath,
      lastFramePath,
      footageEval: footageEval ?? synthesizePassEval(scene.index),
      overlayEval,
      retries: attempt,
    });
  }

  return out;
}

function synthesizePassEval(sceneIndex: number): SceneEval {
  return {
    scene_index: sceneIndex,
    matches_prompt: 10,
    visual_quality: 10,
    on_brand: 10,
    text_clarity: 10,
    graphics_correctness: 10,
    has_unwanted_text: false,
    pass: true,
    issues: [],
  };
}
