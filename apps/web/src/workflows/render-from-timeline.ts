import {
  composeTimeline,
  generateBrief,
  scrape,
  tagScene,
  type MarketingBrief,
  type SceneTag,
  type Timeline,
} from "@cutting-tool/core";
import {
  resolveAnthropicKey,
  resolveElevenLabsKey,
  resolveHiggsfieldCredentials,
} from "@/lib/supabase/admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordJobEvent, updateJobStatus } from "@/lib/jobs";
import { createRenderSandbox } from "@/runners/sandbox";
import { downloadIntoSandbox, generateScene } from "@/runners/higgsfield";
import { concatDemuxer, normalizeForConcat } from "@/runners/ffmpeg-sandbox";
import { trimAndReframe, imageToStillVideo } from "@/runners/ffmpeg-cuts";
import { uploadReelToBlob } from "@/runners/blob";
import { getActiveBrandPreset } from "@/lib/brand";

export interface RenderFromTimelineInput {
  jobId: string;
  projectId: string;
  tenantId: string;
  url: string;                       // optional, drives brief generation
  language: "de" | "en";
  duration_s: 15 | 30 | 60;
}

/**
 * Phase 3 orchestrator — uses uploaded assets (kind=upload, analysis !== null)
 * as primary source material. Falls back to AI-generated B-roll where the
 * cutting agent identifies gaps.
 */
export async function renderFromTimeline(input: RenderFromTimelineInput) {
  "use workflow";

  await markStart(input.jobId);
  const ctx = await scrapeStep(input.jobId, input.url);
  const brief = await briefStep(input, ctx);
  const tags = await tagAllScenesStep(input);
  const timeline = await composeTimelineStep(input, brief, tags);
  const reelUrl = await renderTimelineStep(input, timeline, brief);
  await markDone(input.jobId, reelUrl);
  return { reelUrl, scenes: timeline.entries.length };
}

// ============================================================
async function markStart(jobId: string) {
  "use step";
  await updateJobStatus(jobId, { status: "planning", current_step: "scrape", progress: 5 });
}

async function scrapeStep(jobId: string, url: string) {
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
  input: RenderFromTimelineInput,
  ctx: Awaited<ReturnType<typeof scrape>>,
): Promise<MarketingBrief> {
  "use step";
  await updateJobStatus(input.jobId, { current_step: "brief", progress: 12 });
  const apiKey = await resolveAnthropicKey(input.tenantId, input.projectId);
  // Use 30s for brief sizing regardless of final duration; brief is duration-tolerant.
  const brief = await generateBrief({
    apiKey,
    ctx,
    length_seconds: input.duration_s === 60 ? 60 : 30,
  });
  brief.language = input.language;
  await updateJobStatus(input.jobId, { brief });
  return brief;
}

async function tagAllScenesStep(input: RenderFromTimelineInput): Promise<SceneTag[]> {
  "use step";
  await updateJobStatus(input.jobId, {
    status: "analyzing",
    current_step: "tagging",
    progress: 25,
  });
  const apiKey = await resolveAnthropicKey(input.tenantId, input.projectId);
  const admin = getSupabaseAdminClient();
  const { data: assets, error } = await admin
    .from("assets")
    .select("id, blob_url, analysis, filename")
    .eq("project_id", input.projectId)
    .eq("kind", "upload")
    .is("deleted_at", null)
    .not("analysis", "is", null);
  if (error) throw new Error(`load assets: ${error.message}`);
  if (!assets || assets.length === 0) {
    await recordJobEvent(input.jobId, "agent.thought", {
      step: "tagging",
      note: "no analyzed uploads — composing AI-only timeline",
    });
    return [];
  }

  const allTags: SceneTag[] = [];
  for (const asset of assets) {
    const analysis = asset.analysis as { scenes?: Array<{ start: number; end: number }>; thumbnails?: string[] } | null;
    if (!analysis) continue;
    const scenes = analysis.scenes ?? [];
    if (scenes.length === 0) {
      // Whole-asset single scene
      const tag = await tagScene({
        apiKey,
        asset_id: asset.id,
        scene_id: `${asset.id}_full`,
        start: 0,
        end: 0, // unknown, fine for tagging
        thumbnailBase64Pngs: [],
        metadataNote: `Full asset, filename=${asset.filename ?? ""}`,
      }).catch(() => null);
      if (tag) allTags.push(tag);
      continue;
    }
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i]!;
      const tag = await tagScene({
        apiKey,
        asset_id: asset.id,
        scene_id: `${asset.id}_s${i}`,
        start: s.start,
        end: s.end,
        thumbnailBase64Pngs: [], // future: download analysis.thumbnails[i] as base64
        metadataNote: `Scene ${i + 1}/${scenes.length} of ${asset.filename ?? "upload"}`,
      }).catch(() => null);
      if (tag) allTags.push(tag);
    }
  }

  await recordJobEvent(input.jobId, "agent.thought", {
    step: "tagging",
    total: allTags.length,
    good_for_reel: allTags.filter((t) => t.good_for_reel).length,
  });
  return allTags;
}

async function composeTimelineStep(
  input: RenderFromTimelineInput,
  brief: MarketingBrief,
  tags: SceneTag[],
): Promise<Timeline> {
  "use step";
  await updateJobStatus(input.jobId, {
    status: "composing",
    current_step: "timeline",
    progress: 38,
  });
  const apiKey = await resolveAnthropicKey(input.tenantId, input.projectId);
  const brand = await getActiveBrandPreset(input.projectId);
  const tl = await composeTimeline({
    apiKey,
    brief,
    taggedScenes: tags,
    duration_s: input.duration_s,
    brandStyleDescription: brand?.style_description as string | undefined,
  });
  await updateJobStatus(input.jobId, { timeline: tl as unknown });
  await recordJobEvent(input.jobId, "agent.thought", {
    step: "timeline",
    entries: tl.entries.length,
    captions: tl.captions.length,
    broll_requests: tl.broll_requests.length,
  });
  return tl;
}

async function renderTimelineStep(
  input: RenderFromTimelineInput,
  timeline: Timeline,
  brief: MarketingBrief,
): Promise<string> {
  "use step";
  await updateJobStatus(input.jobId, {
    status: "rendering",
    current_step: "sandbox-spawn",
    progress: 45,
  });

  const brand = await getActiveBrandPreset(input.projectId);
  const lutUrl = brand?.lut_storage_path as string | undefined;
  const hfCredentials = await resolveHiggsfieldCredentials(input.projectId);

  // Resolve source URLs for each entry
  const admin = getSupabaseAdminClient();
  const assetIds = Array.from(new Set(timeline.entries.map((e) => e.source).filter((s) => !s.startsWith("broll_"))));
  const { data: assetRows } = await admin
    .from("assets")
    .select("id, blob_url, mime_type")
    .in("id", assetIds);
  const sourceUrls = new Map((assetRows ?? []).map((r) => [r.id, { url: r.blob_url, mime: r.mime_type as string | null }]));

  const handle = await createRenderSandbox({ timeoutMinutes: 45, vcpus: 4 });
  const { sandbox } = handle;

  try {
    // Stage LUT once
    let lutPath: string | undefined;
    if (lutUrl) {
      lutPath = "brand.cube";
      const dl = await sandbox.runCommand("curl", ["-fsSL", "-o", lutPath, lutUrl]);
      if (dl.exitCode !== 0) throw new Error(`download LUT: ${(await dl.stderr()).slice(0, 400)}`);
    }

    // Resolve B-roll requests via Higgsfield (parallel-ish; sequential here for simplicity)
    const brollUrls = new Map<string, string>();
    for (const req of timeline.broll_requests) {
      const dummyScene = {
        index: 0,
        kind: "b-roll" as const,
        model: req.model,
        duration: req.duration,
        prompt: req.prompt,
        voiceover_text: "",
        uses_native_audio: false,
        chain_from_previous: false,
        overlays: [],
      };
      const out = `${req.id}.mp4`;
      const { url } = await generateScene({
        sandbox,
        scene: dummyScene,
        hfCredentials,
        outputPath: out,
        brandStyleDescription: brand?.style_description as string | undefined,
      });
      await downloadIntoSandbox(sandbox, url, out);
      brollUrls.set(req.id, out);
    }

    // Per-entry trim+reframe. Re-use already-downloaded files for repeated source ids.
    const downloaded = new Set<string>();
    const segmentPaths: string[] = [];

    for (let i = 0; i < timeline.entries.length; i++) {
      const e = timeline.entries[i]!;
      await updateJobStatus(input.jobId, {
        current_step: `cut ${i + 1}/${timeline.entries.length}`,
        progress: 45 + Math.floor(((i + 1) / timeline.entries.length) * 38),
      });

      let sourcePath: string;
      let sourceMime = "video/mp4";

      if (e.source.startsWith("broll_")) {
        sourcePath = brollUrls.get(e.source) ?? "";
        if (!sourcePath) throw new Error(`missing broll source: ${e.source}`);
      } else {
        sourcePath = `src-${e.source}.bin`;
        if (!downloaded.has(e.source)) {
          const info = sourceUrls.get(e.source);
          if (!info) throw new Error(`unknown source asset: ${e.source}`);
          sourceMime = info.mime ?? "video/mp4";
          await downloadIntoSandbox(sandbox, info.url, sourcePath);
          downloaded.add(e.source);
        } else {
          // mime resolved already; assume video
          const info = sourceUrls.get(e.source);
          sourceMime = info?.mime ?? "video/mp4";
        }
      }

      const out = `seg-${i}.mp4`;
      const isImage = sourceMime.startsWith("image/");
      if (isImage) {
        await imageToStillVideo(sandbox, sourcePath, e.t_out - e.t_in, out);
      } else {
        await trimAndReframe(sandbox, sourcePath, e, out);
      }

      // Apply LUT + final normalize
      const norm = `seg-${i}.norm.mp4`;
      await normalizeForConcat(sandbox, out, norm, { lutPath });
      segmentPaths.push(norm);
    }

    await updateJobStatus(input.jobId, { current_step: "concat", progress: 86 });
    const reelPath = "reel.mp4";
    await concatDemuxer(sandbox, segmentPaths, reelPath, ".");

    await updateJobStatus(input.jobId, { current_step: "upload", progress: 95 });
    const buf = await sandbox.readFileToBuffer({ path: reelPath });
    if (!buf) throw new Error("readFileToBuffer empty");
    const blobUrl = await uploadReelToBlob({ jobId: input.jobId, buffer: Buffer.from(buf) });

    void brief; // brief not yet used at render-time (captions in 3.5 follow-up)
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

void resolveElevenLabsKey; // reserved for ducked VO mix in follow-up
