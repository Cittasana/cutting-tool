import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  fetchInstagramBusinessAccount,
} from "@/lib/meta";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { setProjectSecret } from "@/lib/secrets";

export async function GET(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");
  const stored = request.cookies.get("meta_oauth_state")?.value;

  if (!code || !stateParam || !stored || stored !== stateParam) {
    return NextResponse.redirect(new URL("/projects?error=meta-state-mismatch", request.url));
  }

  const projectId = stateParam.split(":")[0]!;

  // Verify ownership again
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .is("deleted_at", null)
    .single();
  if (!project) {
    return NextResponse.redirect(new URL("/projects?error=meta-project-not-found", request.url));
  }

  try {
    const redirectUri = `${process.env.APP_URL ?? request.nextUrl.origin}/api/auth/meta/callback`;
    const shortLived = await exchangeCodeForShortLivedToken(code, redirectUri);
    const longLived = await exchangeForLongLivedToken(shortLived.access_token);
    const igInfo = await fetchInstagramBusinessAccount(longLived.access_token);
    if (!igInfo) {
      return NextResponse.redirect(
        new URL(`/projects/${projectId}?error=no-ig-business-account`, request.url),
      );
    }

    // Store the page-level token (used for IG publishing) in Vault.
    await setProjectSecret(projectId, "meta", igInfo.page_token);

    // Persist non-secret IG metadata + expiry on project_secrets row.
    const expiresAt = new Date(Date.now() + longLived.expires_in * 1000).toISOString();
    const admin = getSupabaseAdminClient();
    await admin
      .from("project_secrets")
      .update({
        ig_business_account_id: igInfo.ig_business_account_id,
        meta_token_expires_at: expiresAt,
      })
      .eq("project_id", projectId);

    const response = NextResponse.redirect(
      new URL(`/projects/${projectId}?ig_connected=${encodeURIComponent(igInfo.ig_username)}`, request.url),
    );
    response.cookies.delete("meta_oauth_state");
    return response;
  } catch (e) {
    return NextResponse.redirect(
      new URL(
        `/projects/${projectId}?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`,
        request.url,
      ),
    );
  }
}
