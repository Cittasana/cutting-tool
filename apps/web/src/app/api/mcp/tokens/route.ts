import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateMcpToken } from "@/lib/mcp-auth";

const Body = z.object({ name: z.string().min(1).max(80) });

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { plaintext, hash, prefix } = generateMcpToken();
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("mcp_tokens")
    .insert({
      user_id: user.id,
      name: body.data.name,
      token_hash: hash,
      prefix,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id, plaintext, prefix });
}
