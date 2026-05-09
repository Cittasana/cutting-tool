import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { start } from "workflow/api";
import { renderReel } from "@/workflows/render-reel";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createJob, updateJobStatus } from "@/lib/jobs";

const Body = z.object({
  url: z.string().url(),
  length_seconds: z.union([z.literal(30), z.literal(60)]),
  language: z.enum(["de", "en"]),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params;

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("id, tenant_id, language")
    .eq("id", projectId)
    .is("deleted_at", null)
    .single();
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const json = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const job = await createJob({ projectId: project.id });

  try {
    const handle = await start(renderReel, [
      {
        jobId: job.id,
        projectId: project.id,
        tenantId: project.tenant_id,
        url: parsed.data.url,
        language: parsed.data.language,
        length_seconds: parsed.data.length_seconds,
      },
    ]);
    const runId =
      typeof handle === "object" && handle && "runId" in handle
        ? String((handle as { runId: unknown }).runId)
        : null;
    if (runId) await updateJobStatus(job.id, { workflow_run_id: runId, started_at: new Date().toISOString() });
  } catch (e) {
    await updateJobStatus(job.id, {
      status: "failed",
      error: { message: e instanceof Error ? e.message : String(e) },
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  return NextResponse.json({ job_id: job.id }, { status: 202 });
}
