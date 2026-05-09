import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { generateBrief, generateStoryboard, scrape } from "@cutting-tool/core";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { resolveAnthropicKey } from "@/lib/supabase/admin";

const Body = z.object({
  url: z.string().url(),
  length_seconds: z.union([z.literal(30), z.literal(60)]),
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

  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, tenant_id")
    .eq("id", projectId)
    .is("deleted_at", null)
    .single();
  if (projectErr || !project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const json = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { url, length_seconds } = parsed.data;

  let apiKey: string;
  try {
    apiKey = await resolveAnthropicKey(project.tenant_id, project.id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "secret resolution failed" },
      { status: 400 },
    );
  }

  try {
    const ctx = await scrape(url);
    const brief = await generateBrief({ apiKey, ctx, length_seconds });
    const storyboard = await generateStoryboard({
      apiKey,
      brief,
      length_seconds,
    });
    return NextResponse.json({ brief, storyboard, scraped: { title: ctx.title, chunks: ctx.copy_chunks.length } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const maxDuration = 300;
