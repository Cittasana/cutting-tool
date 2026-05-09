import {
  generateBrief,
  generateStoryboard,
  scrape,
  type MarketingBrief,
  type ProductContext,
  type Scene,
  type Storyboard,
} from "@cutting-tool/core";
import {
  resolveAnthropicKey,
  resolveElevenLabsKey,
  resolveHiggsfieldCredentials,
} from "@/lib/supabase/admin";
import { recordJobEvent, updateJobStatus } from "@/lib/jobs";
import { createRenderSandbox } from "@/runners/sandbox";
import {
  downloadIntoSandbox,
  extractLastFrame,
  generateScene,
} from "@/runners/higgsfield";
import { synthesizeVoiceover } from "@/runners/elevenlabs";
import {
  concatDemuxer,
  ensureSilentAudio,
  muxVoiceover,
  normalizeForConcat,
} from "@/runners/ffmpeg-sandbox";
import { uploadReelToBlob } from "@/runners/blob";
import { getActiveBrandPreset } from "@/lib/brand";

export interface RenderReelInput {
  jobId: string;
  projectId: string;
  tenantId: string;
  url: string;
  language: "de" | "en";
  length_seconds: 30 | 60;
  voiceId?: string;
}

export async function renderReel(input: RenderReelInput) {
  "use workflow";

  await markStarted(input.jobId);

  const ctx = await scrapeStep(input.jobId, input.url);
  const brief = await briefStep(input, ctx);
  const storyboard = await storyboardStep(input, brief);
  await markStorybardReady(input.jobId, brief, storyboard);

  // Pre-synthesize all voiceovers in parallel (Veo silent scenes only).
  const voiceovers = await synthesizeVoiceoversStep(input, storyboard);

  // Render all scenes in one Sandbox (create → install → per-scene generate
  // → mux VO → normalize → concat → upload to Blob).
  const reelUrl = await renderInSandboxStep(input, storyboard, voiceovers);

  await markDone(input.jobId, reelUrl);
  return { reelUrl };
}

// ============================================================
// Steps
// ============================================================
async function markStarted(jobId: string) {
  "use step";
  await updateJobStatus(jobId, { status: "planning", current_step: "scrape", progress: 5 });
  await recordJobEvent(jobId, "step.started", { step: "scrape" });
}

async function scrapeStep(jobId: string, url: string): Promise<ProductContext> {
  "use step";
  const ctx = await scrape(url);
  await recordJobEvent(jobId, "step.finished", {
    step: "scrape",
    title: ctx.title,
    chunks: ctx.copy_chunks.length,
  });
  return ctx;
}

async function briefStep(
  input: RenderReelInput,
  ctx: ProductContext,
): Promise<MarketingBrief> {
  "use step";
  await updateJobStatus(input.jobId, { current_step: "brief", progress: 15 });
  const apiKey = await resolveAnthropicKey(input.tenantId, input.projectId);
  const brief = await generateBrief({ apiKey, ctx, length_seconds: input.length_seconds });
  brief.language = input.language;
  await recordJobEvent(input.jobId, "agent.thought", {
    step: "brief",
    hook: brief.hook,
    cta: brief.cta,
  });
  return brief;
}

async function storyboardStep(
  input: RenderReelInput,
  brief: MarketingBrief,
): Promise<Storyboard> {
  "use step";
  await updateJobStatus(input.jobId, { current_step: "storyboard", progress: 30 });
  const apiKey = await resolveAnthropicKey(input.tenantId, input.projectId);
  const sb = await generateStoryboard({ apiKey, brief, length_seconds: input.length_seconds });
  await recordJobEvent(input.jobId, "agent.thought", {
    step: "storyboard",
    scene_count: sb.scenes.length,
    total_duration: sb.total_duration_seconds,
  });
  return sb;
}

async function markStorybardReady(
  jobId: string,
  brief: MarketingBrief,
  storyboard: Storyboard,
) {
  "use step";
  await updateJobStatus(jobId, {
    brief,
    storyboard,
    progress: 40,
    current_step: "voiceovers",
  });
}

interface VoiceoverEntry {
  sceneIndex: number;
  base64: string;          // mp3, base64-encoded so it's serialisable
}

async function synthesizeVoiceoversStep(
  input: RenderReelInput,
  storyboard: Storyboard,
): Promise<VoiceoverEntry[]> {
  "use step";
  const veoScenes = storyboard.scenes.filter(
    (s) => !s.uses_native_audio && s.voiceover_text.trim().length > 0,
  );
  if (veoScenes.length === 0) return [];

  const apiKey = await resolveElevenLabsKey(input.projectId);
  const voiceId = input.voiceId ?? "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs Rachel default
  const audios = await Promise.all(
    veoScenes.map(async (s) => {
      const buf = await synthesizeVoiceover({
        apiKey,
        voiceId,
        text: s.voiceover_text,
      });
      return { sceneIndex: s.index, base64: buf.toString("base64") };
    }),
  );

  await recordJobEvent(input.jobId, "step.finished", {
    step: "voiceovers",
    count: audios.length,
  });
  return audios;
}

async function renderInSandboxStep(
  input: RenderReelInput,
  storyboard: Storyboard,
  voiceovers: VoiceoverEntry[],
): Promise<string> {
  "use step";
  await updateJobStatus(input.jobId, {
    status: "rendering",
    current_step: "sandbox-spawn",
    progress: 45,
  });

  const hfCredentials = await resolveHiggsfieldCredentials(input.projectId);
  const brandPreset = await getActiveBrandPreset(input.projectId);
  const lutUrl = brandPreset?.lut_storage_path as string | undefined;

  const handle = await createRenderSandbox({
    timeoutMinutes: 30,
    vcpus: 4,
  });
  const { sandbox } = handle;

  try {
    // Stage VO files inside sandbox.
    if (voiceovers.length > 0) {
      await sandbox.writeFiles(
        voiceovers.map((vo) => ({
          path: `vo-${vo.sceneIndex}.mp3`,
          content: Buffer.from(vo.base64, "base64"),
        })),
      );
    }

    // Download brand LUT once (shared across all scenes).
    let lutPath: string | undefined;
    if (lutUrl) {
      lutPath = "brand.cube";
      const dl = await sandbox.runCommand("curl", ["-fsSL", "-o", lutPath, lutUrl]);
      if (dl.exitCode !== 0) {
        const stderr = await dl.stderr();
        throw new Error(`download brand LUT: ${stderr.slice(0, 400)}`);
      }
      await recordJobEvent(input.jobId, "agent.thought", {
        step: "brand-lut",
        url: lutUrl,
      });
    }

    let prevLastFrame: string | undefined;
    const finalScenePaths: string[] = [];

    for (const scene of storyboard.scenes) {
      const sceneNum = scene.index;
      await updateJobStatus(input.jobId, {
        current_step: `scene ${sceneNum}/${storyboard.scenes.length}`,
        progress: 45 + Math.floor((sceneNum / storyboard.scenes.length) * 40),
      });
      await recordJobEvent(input.jobId, "step.started", { step: `scene-${sceneNum}` });

      const rawPath = `scene-${sceneNum}.raw.mp4`;
      const { url, jobId } = await generateScene({
        sandbox,
        scene,
        hfCredentials,
        prevLastFramePath: scene.chain_from_previous ? prevLastFrame : undefined,
        outputPath: rawPath,
        brandStyleDescription: brandPreset?.style_description as string | undefined,
      });
      await downloadIntoSandbox(sandbox, url, rawPath);
      await recordJobEvent(input.jobId, "scene.preview", {
        scene: sceneNum,
        higgsfield_job: jobId,
        url,
      });

      // Chain frame for next scene
      const lastFrame = `scene-${sceneNum}.last.png`;
      await extractLastFrame(sandbox, rawPath, lastFrame);
      prevLastFrame = lastFrame;

      // Mux voiceover (Veo silent scenes) or pass-through (Seedance native audio)
      const muxedPath = `scene-${sceneNum}.muxed.mp4`;
      const vo = voiceovers.find((v) => v.sceneIndex === sceneNum);
      if (vo) {
        await muxVoiceover(sandbox, rawPath, `vo-${sceneNum}.mp3`, muxedPath);
      } else if (scene.uses_native_audio) {
        // Seedance — keep native audio
        await sandbox.runCommand("cp", [rawPath, muxedPath]);
      } else {
        // Defensive: silent track
        await ensureSilentAudio(sandbox, rawPath, muxedPath);
      }

      // Normalize for concat (apply brand LUT if configured)
      const normPath = `scene-${sceneNum}.norm.mp4`;
      await normalizeForConcat(sandbox, muxedPath, normPath, { lutPath });
      finalScenePaths.push(normPath);

      await recordJobEvent(input.jobId, "step.finished", { step: `scene-${sceneNum}` });
    }

    await updateJobStatus(input.jobId, {
      current_step: "concat",
      progress: 88,
    });
    const reelPath = `reel.mp4`;
    await concatDemuxer(sandbox, finalScenePaths, reelPath, ".");

    await updateJobStatus(input.jobId, {
      current_step: "upload",
      progress: 94,
    });
    const buffer = await sandbox.readFileToBuffer({ path: reelPath });
    if (!buffer) throw new Error("readFileToBuffer returned empty");

    const blobUrl = await uploadReelToBlob({ jobId: input.jobId, buffer });
    return blobUrl;
  } finally {
    await handle.stop();
  }
}

async function markDone(jobId: string, reelUrl: string) {
  "use step";
  await updateJobStatus(jobId, {
    status: "done",
    current_step: "done",
    progress: 100,
    finished_at: new Date().toISOString(),
  });
  await recordJobEvent(jobId, "step.finished", { step: "render", reel_url: reelUrl });
}
