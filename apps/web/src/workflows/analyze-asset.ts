import { analyzeAssetInSandbox } from "@/runners/analyze-sandbox";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export interface AnalyzeAssetInput {
  assetId: string;
  projectId: string;
  blobUrl: string;
  filename: string;
}

/**
 * Analyze a single uploaded asset and persist the result onto the assets row.
 * Triggered manually (or post-upload) from /api/projects/[id]/uploads/[assetId]/analyze.
 */
export async function analyzeAsset(input: AnalyzeAssetInput) {
  "use workflow";
  await markAnalyzing(input.assetId);
  const result = await runAnalysis(input);
  await persistResult(input.assetId, result);
  return { assetId: input.assetId, scenes: countScenes(result) };
}

async function markAnalyzing(assetId: string) {
  "use step";
  const admin = getSupabaseAdminClient();
  await admin.from("assets").update({
    metadata: { analyzing: true, started_at: new Date().toISOString() },
  }).eq("id", assetId);
}

async function runAnalysis(input: AnalyzeAssetInput): Promise<unknown> {
  "use step";
  return await analyzeAssetInSandbox({
    assetUrl: input.blobUrl,
    filename: input.filename,
  });
}

async function persistResult(assetId: string, result: unknown) {
  "use step";
  const admin = getSupabaseAdminClient();
  await admin.from("assets").update({
    analysis: result,
    metadata: { analyzed_at: new Date().toISOString() },
  }).eq("id", assetId);
}

function countScenes(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const r = result as { scenes?: unknown };
  return Array.isArray(r.scenes) ? r.scenes.length : 0;
}
