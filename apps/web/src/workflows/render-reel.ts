import {
  evaluateFinal,
  evaluateFootage,
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
import { sampleFramesAsBase64 } from "@/runners/frame-sample";
import { applyOverlays } from "@/runners/overlay";
import { renderTextOverlayPng } from "@/runners/text-render";
import { pickIconSizePx, resolveFontUrl, resolveIconUrl } from "@/runners/asset-resolve";
import { mixBackgroundMusic } from "@/runners/ffmpeg-mix";
import { getActiveBrandPreset } from "@/lib/brand";

const MAX_RETRIES_PER_SCENE = 2;
const MAX_SCENE_RETRIES_PER_RUN = 4;

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

    // Pre-fetch the project font (or platform default) into a Buffer for
    // @resvg/resvg-js text renders. The font file itself is also staged into
    // the sandbox in case future steps need it (e.g. ffmpeg drawtext).
    const fontUrl = resolveFontUrl(brandPreset?.font_storage_path as string | undefined);
    const fontResp = await fetch(fontUrl);
    if (!fontResp.ok) throw new Error(`font fetch ${fontUrl}: ${fontResp.status}`);
    const fontBuffer = Buffer.from(await fontResp.arrayBuffer());

    const apiKey = await resolveAnthropicKey(input.tenantId, input.projectId);
    let prevLastFrame: string | undefined;
    const finalScenePaths: string[] = [];
    let runRetries = 0;

    const brief = (await getJobBrief(input.jobId)) as MarketingBrief;

    for (const scene of storyboard.scenes) {
      const sceneNum = scene.index;
      await updateJobStatus(input.jobId, {
        current_step: `scene ${sceneNum}/${storyboard.scenes.length}`,
        progress: 45 + Math.floor((sceneNum / storyboard.scenes.length) * 40),
      });
      await recordJobEvent(input.jobId, "step.started", { step: `scene-${sceneNum}` });

      let rawPath = `scene-${sceneNum}.raw.mp4`;
      let activePrompt = scene.prompt;
      let attempt = 0;
      let scenePassed = false;

      while (attempt <= MAX_RETRIES_PER_SCENE && !scenePassed) {
        const sceneForGen: Scene = { ...scene, prompt: activePrompt };
        const { url, jobId } = await generateScene({
          sandbox,
          scene: sceneForGen,
          hfCredentials,
          prevLastFramePath: scene.chain_from_previous ? prevLastFrame : undefined,
          outputPath: rawPath,
          brandStyleDescription: brandPreset?.style_description as string | undefined,
        });
        await downloadIntoSandbox(sandbox, url, rawPath);
        await recordJobEvent(input.jobId, "scene.preview", {
          scene: sceneNum,
          attempt: attempt + 1,
          higgsfield_job: jobId,
          url,
        });

        // Vision QC: 3 frames → evaluateFootage
        const frames = await sampleFramesAsBase64(sandbox, rawPath, `s${sceneNum}-a${attempt + 1}`, 3);
        const evalReport = await evaluateFootage({
          apiKey,
          scene,
          brief,
          frameBase64Pngs: frames,
        });
        await recordJobEvent(input.jobId, "agent.thought", {
          step: `scene-${sceneNum}-eval`,
          attempt: attempt + 1,
          ...evalReport,
        });

        if (evalReport.pass) {
          scenePassed = true;
          break;
        }

        attempt++;
        runRetries++;
        if (runRetries > MAX_SCENE_RETRIES_PER_RUN) {
          throw new Error(
            `Run exceeded MAX_SCENE_RETRIES_PER_RUN (${MAX_SCENE_RETRIES_PER_RUN}). Last scene ${sceneNum} eval: ${JSON.stringify(evalReport)}`,
          );
        }
        const hint = evalReport.prompt_revision_hint ?? "";
        const negText = evalReport.has_unwanted_text
          ? " ABSOLUTELY NO ON-SCREEN TEXT, NO CAPTIONS, NO SIGNS, NO LOGOS, NO WATERMARKS. Pure cinematic footage only — any visible writing or graphics is a hard failure."
          : "";
        activePrompt = `${scene.prompt}\n\nDirector note: ${hint}${negText}`;
      }

      if (!scenePassed) {
        throw new Error(`Scene ${sceneNum} failed after ${MAX_RETRIES_PER_SCENE + 1} attempts.`);
      }

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

      // Overlays: text via @resvg/resvg-js (Vercel Function), icons via curl
      // platform defaults; both staged into sandbox. Filter_complex chain
      // overlays each with start/end timing.
      const overlaidPath = await applySceneOverlays(
        sandbox,
        scene,
        muxedPath,
        brandPreset?.font_storage_path as string | undefined,
        fontBuffer,
      );

      // Normalize for concat (apply brand LUT if configured)
      const normPath = `scene-${sceneNum}.norm.mp4`;
      await normalizeForConcat(sandbox, overlaidPath, normPath, { lutPath });
      finalScenePaths.push(normPath);

      await recordJobEvent(input.jobId, "step.finished", { step: `scene-${sceneNum}` });
    }

    await updateJobStatus(input.jobId, {
      current_step: "concat",
      progress: 88,
    });
    const reelPath = `reel.mp4`;
    await concatDemuxer(sandbox, finalScenePaths, reelPath, ".");

    // Optional: mix brand BGM with sidechain duck on top of concatenated reel.
    let preEvalReel = reelPath;
    const musicUrl = brandPreset?.music_storage_path as string | undefined;
    if (musicUrl) {
      const musicLocal = "music.bin";
      const dl = await sandbox.runCommand("curl", ["-fsSL", "-o", musicLocal, musicUrl]);
      if (dl.exitCode === 0) {
        preEvalReel = "reel.mixed.mp4";
        await mixBackgroundMusic(sandbox, reelPath, musicLocal, preEvalReel);
        await recordJobEvent(input.jobId, "agent.thought", { step: "bgm-mixed", url: musicUrl });
      }
    }

    await updateJobStatus(input.jobId, {
      status: "evaluating",
      current_step: "final-eval",
      progress: 92,
    });
    // Final QC across the assembled reel
    const reelFrames = await sampleFramesAsBase64(
      sandbox,
      preEvalReel,
      "reel",
      Math.min(8, Math.ceil(storyboard.total_duration_seconds / 4)),
    );
    const veoTranscript = storyboard.scenes
      .filter((s) => !s.uses_native_audio && s.voiceover_text)
      .map((s) => `[scene ${s.index}] ${s.voiceover_text}`)
      .join("\n");
    const finalReport = await evaluateFinal({
      apiKey,
      reelFrameBase64Pngs: reelFrames,
      brief,
      storyboard,
      veoVoiceoverTranscript: veoTranscript,
    });
    await recordJobEvent(input.jobId, "agent.thought", {
      step: "final-eval",
      ...finalReport,
    });
    if (!finalReport.pass) {
      // Don't block ship — surface as warning but continue. Operator
      // decides whether to repost. (v1 had interactive prompt; v2 keeps
      // the artifact and lets the user decide.)
      await recordJobEvent(input.jobId, "error", {
        step: "final-eval",
        verdict: finalReport.one_line_verdict,
        issues: finalReport.issues,
      });
    }

    await updateJobStatus(input.jobId, {
      current_step: "upload",
      progress: 96,
    });
    const buffer = await sandbox.readFileToBuffer({ path: preEvalReel });
    if (!buffer) throw new Error("readFileToBuffer returned empty");

    const blobUrl = await uploadReelToBlob({ jobId: input.jobId, buffer });
    return blobUrl;
  } finally {
    await handle.stop();
  }
}

/**
 * Pre-render text PNGs (Vercel Function side) + curl icon PNGs from
 * platform defaults (or project assets), stage into sandbox, then run
 * applyOverlays. Returns the path to the overlaid clip.
 */
async function applySceneOverlays(
  sandbox: Awaited<ReturnType<typeof createRenderSandbox>>["sandbox"],
  scene: Scene,
  inputPath: string,
  _projectFontUrl: string | undefined,
  fontBuffer: Buffer,
): Promise<string> {
  if (scene.overlays.length === 0) return inputPath;
  const sceneNum = scene.index;

  const textPaths: Record<number, string> = {};
  const iconPaths: Record<number, string> = {};
  const writes: Array<{ path: string; content: Buffer }> = [];
  const iconCurls: Array<{ url: string; path: string }> = [];

  for (let i = 0; i < scene.overlays.length; i++) {
    const ov = scene.overlays[i]!;
    if (ov.kind === "text") {
      const png = await renderTextOverlayPng({ overlay: ov, fontBuffer });
      const path = `scene-${sceneNum}-text-${i}.png`;
      writes.push({ path, content: png });
      textPaths[i] = path;
    } else {
      const sizePx = pickIconSizePx(1920, ov.size_pct);
      const url = resolveIconUrl(ov.name, sizePx);
      if (!url) {
        throw new Error(`icon "${ov.name}" not found in defaults`);
      }
      const path = `scene-${sceneNum}-icon-${i}.png`;
      iconCurls.push({ url, path });
      iconPaths[i] = path;
    }
  }

  if (writes.length > 0) {
    await sandbox.writeFiles(writes);
  }
  for (const { url, path } of iconCurls) {
    const cmd = await sandbox.runCommand("curl", ["-fsSL", "-o", path, url]);
    if (cmd.exitCode !== 0) {
      throw new Error(`download icon ${url}: ${(await cmd.stderr()).slice(0, 400)}`);
    }
  }

  const out = `scene-${sceneNum}.ovl.mp4`;
  await applyOverlays({
    sandbox,
    input: inputPath,
    output: out,
    scene,
    textOverlayPaths: textPaths,
    iconOverlayPaths: iconPaths,
  });
  return out;
}

async function getJobBrief(jobId: string): Promise<MarketingBrief> {
  "use step";
  const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("jobs")
    .select("brief")
    .eq("id", jobId)
    .single();
  if (error || !data?.brief) {
    throw new Error(`getJobBrief: ${error?.message ?? "no brief"}`);
  }
  return data.brief as MarketingBrief;
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
