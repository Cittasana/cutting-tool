import { NextResponse, type NextRequest } from "next/server";
import { buildOAuthRedirect } from "@/lib/meta";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ error: "project_id required" }, { status: 400 });
  }

  // Verify user owns the project before issuing redirect.
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .is("deleted_at", null)
    .single();
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const state = `${projectId}:${crypto.randomUUID()}`;
  const redirectUri = `${process.env.APP_URL ?? request.nextUrl.origin}/api/auth/meta/callback`;
  const url = buildOAuthRedirect(state, redirectUri);

  const response = NextResponse.redirect(url);
  // Stash state in an httponly cookie so callback can verify CSRF.
  response.cookies.set({
    name: "meta_oauth_state",
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
