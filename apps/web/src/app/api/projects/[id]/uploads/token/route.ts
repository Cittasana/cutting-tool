import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const ACCEPTED_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params;

  // First: authorize via session that the user owns this project. If not,
  // refuse to issue an upload token. This runs BEFORE the @vercel/blob/client
  // handshake so unauthorized clients get a clean 401 instead of a token.
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: project } = await supabase
    .from("projects")
    .select("id, tenant_id")
    .eq("id", projectId)
    .is("deleted_at", null)
    .single();
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ACCEPTED_MIMES,
        addRandomSuffix: true,
        maximumSizeInBytes: 5 * 1024 * 1024 * 1024, // 5 GB; use multipart > 100 MB
        tokenPayload: JSON.stringify({ projectId, userId: user.id, pathname }),
      }),
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        if (!tokenPayload) return;
        const meta = JSON.parse(tokenPayload) as { projectId: string; userId: string };
        if (meta.projectId !== projectId) return; // mismatched token, ignore
        const admin = getSupabaseAdminClient();
        await admin.from("assets").insert({
          project_id: projectId,
          kind: "upload",
          blob_url: blob.url,
          filename: blob.pathname.split("/").pop() ?? null,
          mime_type: blob.contentType ?? null,
          metadata: { uploadedBy: meta.userId },
        });
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
