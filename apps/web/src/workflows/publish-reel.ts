import { sleep } from "workflow";
import {
  createReelContainer,
  getContainerStatus,
  publishContainer,
} from "@/lib/meta";
import { getSupabaseAdminClient, getProjectSecret } from "@/lib/supabase/admin";
import { recordJobEvent, updateJobStatus } from "@/lib/jobs";

export interface PublishReelInput {
  jobId: string;
  projectId: string;
  reelUrl: string;       // public Blob URL of finished reel.mp4
  caption: string;
  shareToFeed?: boolean;
}

/**
 * Publish a finished reel to Instagram via the Reels Container API.
 *  1. POST /media → container_id
 *  2. poll /container_id?fields=status_code until FINISHED (or ERROR)
 *  3. POST /media_publish → media_id
 */
export async function publishReel(input: PublishReelInput) {
  "use workflow";

  await markPosting(input.jobId);
  const { containerId, igId, pageToken } = await createContainer(input);
  await pollContainer(input, containerId, pageToken);
  const mediaId = await doPublish(input, containerId, igId, pageToken);
  await markPublished(input.jobId, mediaId);
  return { mediaId };
}

async function markPosting(jobId: string) {
  "use step";
  await updateJobStatus(jobId, { status: "posting", current_step: "ig-container", progress: 96 });
}

async function createContainer(input: PublishReelInput) {
  "use step";
  const { igId, pageToken } = await loadIgCreds(input.projectId);
  const { container_id } = await createReelContainer({
    igBusinessAccountId: igId,
    pageToken,
    videoUrl: input.reelUrl,
    caption: input.caption,
    shareToFeed: input.shareToFeed ?? true,
  });
  await recordJobEvent(input.jobId, "agent.thought", {
    step: "ig-container-created",
    container_id,
  });
  return { containerId: container_id, igId, pageToken };
}

async function pollContainer(
  input: PublishReelInput,
  containerId: string,
  pageToken: string,
) {
  "use workflow";
  // up to 6 minutes (Meta usually ~30s but transcoding can take longer)
  for (let i = 0; i < 36; i++) {
    const status = await checkStatus(containerId, pageToken);
    await recordJobEvent(input.jobId, "step.started", {
      step: "ig-container-poll",
      attempt: i + 1,
      status_code: status,
    });
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`IG container status=${status}`);
    }
    await sleep("10s");
  }
  throw new Error("IG container poll timed out (>6 min)");
}

async function checkStatus(containerId: string, pageToken: string): Promise<string> {
  "use step";
  const { status_code } = await getContainerStatus({ containerId, pageToken });
  return status_code;
}

async function doPublish(
  input: PublishReelInput,
  containerId: string,
  igId: string,
  pageToken: string,
) {
  "use step";
  const { media_id } = await publishContainer({
    igBusinessAccountId: igId,
    pageToken,
    containerId,
  });
  await recordJobEvent(input.jobId, "agent.thought", {
    step: "ig-published",
    media_id,
  });
  return media_id;
}

async function markPublished(jobId: string, mediaId: string) {
  "use step";
  await updateJobStatus(jobId, {
    status: "done",
    current_step: `published mediaId=${mediaId}`,
    progress: 100,
    finished_at: new Date().toISOString(),
  });
}

async function loadIgCreds(projectId: string): Promise<{ igId: string; pageToken: string }> {
  "use step";
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("project_secrets")
    .select("ig_business_account_id, meta_token_expires_at")
    .eq("project_id", projectId)
    .single();
  if (error || !data?.ig_business_account_id) {
    throw new Error("Instagram not connected for this project");
  }
  if (data.meta_token_expires_at && new Date(data.meta_token_expires_at) < new Date()) {
    throw new Error("Meta token expired — reconnect Instagram");
  }
  const pageToken = await getProjectSecret(projectId, "meta");
  if (!pageToken) throw new Error("Meta page token missing in vault");
  return { igId: data.ig_business_account_id, pageToken };
}
