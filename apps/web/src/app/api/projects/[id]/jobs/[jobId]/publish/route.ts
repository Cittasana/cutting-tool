import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { start } from "workflow/api";
import { publishReel } from "@/workflows/publish-reel";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const Body = z.object({
  caption: z.string().min(1).max(2200),
  share_to_feed: z.boolean().default(true),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; jobId: string }> },
) {
  const { id: projectId, jobId } = await ctx.params;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .is("deleted_at", null)
    .single();
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid body", details: body.error.flatten() }, { status: 400 });
  }

  // Find finished reel asset for this job
  const admin = getSupabaseAdminClient();
  const { data: job } = await admin
    .from("jobs")
    .select("id, output_asset_id, status")
    .eq("id", jobId)
    .eq("project_id", projectId)
    .single();
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  if (job.status !== "done" || !job.output_asset_id) {
    return NextResponse.json({ error: "job not finished or no output asset" }, { status: 400 });
  }
  const { data: asset } = await admin
    .from("assets")
    .select("blob_url")
    .eq("id", job.output_asset_id)
    .single();
  if (!asset?.blob_url) {
    return NextResponse.json({ error: "reel asset URL missing" }, { status: 500 });
  }

  await start(publishReel, [
    {
      jobId,
      projectId,
      reelUrl: asset.blob_url,
      caption: body.data.caption,
      shareToFeed: body.data.share_to_feed,
    },
  ]);
  return NextResponse.json({ status: "queued" }, { status: 202 });
}
