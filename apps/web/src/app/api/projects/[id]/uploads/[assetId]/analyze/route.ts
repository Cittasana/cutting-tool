import { NextResponse, type NextRequest } from "next/server";
import { start } from "workflow/api";
import { analyzeAsset } from "@/workflows/analyze-asset";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id: projectId, assetId } = await ctx.params;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: asset } = await supabase
    .from("assets")
    .select("id, project_id, blob_url, filename")
    .eq("id", assetId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .single();
  if (!asset) return NextResponse.json({ error: "asset not found" }, { status: 404 });

  await start(analyzeAsset, [
    {
      assetId: asset.id,
      projectId: asset.project_id,
      blobUrl: asset.blob_url,
      filename: asset.filename ?? "input.bin",
    },
  ]);
  return NextResponse.json({ status: "queued" }, { status: 202 });
}
