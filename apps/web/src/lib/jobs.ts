import { getSupabaseAdminClient } from "./supabase/admin";
import type { JobStatus, MarketingBrief, Storyboard } from "@cutting-tool/core";

export interface JobUpdate {
  status?: JobStatus;
  progress?: number;
  current_step?: string | null;
  brief?: MarketingBrief | null;
  storyboard?: Storyboard | null;
  output_asset_id?: string | null;
  workflow_run_id?: string | null;
  error?: unknown;
  started_at?: string | null;
  finished_at?: string | null;
}

export async function updateJobStatus(jobId: string, update: JobUpdate): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from("jobs").update(update).eq("id", jobId);
  if (error) throw new Error(`updateJobStatus(${jobId}): ${error.message}`);

  // Broadcast progress to live listeners on channel `job:<id>`.
  if (update.progress !== undefined || update.current_step !== undefined || update.status !== undefined) {
    await admin.channel(`job:${jobId}`).send({
      type: "broadcast",
      event: "progress",
      payload: {
        progress: update.progress,
        current_step: update.current_step,
        status: update.status,
      },
    });
  }
}

export async function recordJobEvent(
  jobId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const admin = getSupabaseAdminClient();
  await admin.from("job_events").insert({ job_id: jobId, type, payload });
  await admin.channel(`job:${jobId}`).send({
    type: "broadcast",
    event: type,
    payload,
  });
}

export async function createJob(opts: {
  projectId: string;
  brand_preset_id?: string | null;
  brand_preset_version?: number | null;
}): Promise<{ id: string }> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("jobs")
    .insert({
      project_id: opts.projectId,
      brand_preset_id: opts.brand_preset_id ?? null,
      brand_preset_version: opts.brand_preset_version ?? null,
      status: "queued",
      progress: 0,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`createJob: ${error?.message ?? "no data"}`);
  return { id: data.id };
}
