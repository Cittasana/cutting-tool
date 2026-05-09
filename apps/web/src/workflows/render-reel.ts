import { sleep } from "workflow";
import {
  generateBrief,
  generateStoryboard,
  scrape,
  type MarketingBrief,
  type ProductContext,
  type Storyboard,
} from "@cutting-tool/core";
import { resolveAnthropicKey } from "@/lib/supabase/admin";
import { recordJobEvent, updateJobStatus } from "@/lib/jobs";

export interface RenderReelInput {
  jobId: string;
  projectId: string;
  tenantId: string;
  url: string;
  language: "de" | "en";
  length_seconds: 30 | 60;
}

/**
 * Top-level workflow for rendering a Reel from a product URL.
 *
 * Phase 1 etappe 2 — currently implements brief + storyboard as durable steps.
 * Stages 3..7 (scene generation in Sandbox, ElevenLabs TTS, render, eval, post)
 * are stubs we'll fill in subsequent commits.
 */
export async function renderReel(input: RenderReelInput) {
  "use workflow";

  await markStarted(input.jobId);

  const ctx = await scrapeStep(input.jobId, input.url);
  const brief = await briefStep(input, ctx);
  const storyboard = await storyboardStep(input, brief);

  await markStorybardReady(input.jobId, brief, storyboard);

  // TODO Stage 3 — generateScenes(input, storyboard)  (Vercel Sandbox + Higgsfield CLI)
  // TODO Stage 4 — synthesizeVoiceovers(input, storyboard)
  // TODO Stage 5 — renderFinal(input, scenes)         (Vercel Sandbox + ffmpeg)
  // TODO Stage 6 — evaluateFinal(input, reel)
  // TODO Stage 7 — postToInstagram(input, reel)        (when project.auto_post_enabled)

  await markPaused(input.jobId);
  return { brief, storyboard };
}

async function markStarted(jobId: string) {
  "use step";
  await updateJobStatus(jobId, { status: "planning", current_step: "scrape", progress: 5 });
  await recordJobEvent(jobId, "step.started", { step: "scrape" });
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
  input: RenderReelInput,
  ctx: ProductContext,
): Promise<MarketingBrief> {
  "use step";
  await updateJobStatus(input.jobId, { current_step: "brief", progress: 15 });
  const apiKey = await resolveAnthropicKey(input.tenantId, input.projectId);
  const brief = await generateBrief({
    apiKey,
    ctx,
    length_seconds: input.length_seconds,
  });
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
  const sb = await generateStoryboard({
    apiKey,
    brief,
    length_seconds: input.length_seconds,
  });
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
    current_step: "storyboard-ready",
  });
}

async function markPaused(jobId: string) {
  "use step";
  await updateJobStatus(jobId, {
    status: "done",
    current_step: "phase-1-etappe-2 stops here (next: scene generation)",
    progress: 100,
    finished_at: new Date().toISOString(),
  });
  // For now we mark "done" so the UI shows a final state. Once stages 3..7
  // land we'll keep the job in "rendering"/"posting" states.
  await sleep("0s");
}
