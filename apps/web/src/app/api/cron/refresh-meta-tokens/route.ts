import { NextResponse, type NextRequest } from "next/server";
import { refreshLongLivedToken } from "@/lib/meta";
import { getSupabaseAdminClient, getProjectSecret } from "@/lib/supabase/admin";
import { setProjectSecret } from "@/lib/secrets";

/**
 * Daily cron: refresh any Meta page tokens whose expiry is within 7 days.
 * Long-lived tokens last 60 days; refreshing them resets the 60d clock.
 *
 * Schedule via vercel.ts:
 *   crons: [{ path: "/api/cron/refresh-meta-tokens", schedule: "0 3 * * *" }]
 *
 * Authorization: Vercel cron sets `x-vercel-cron: 1` header on its requests.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get("x-vercel-cron") !== "1" && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = getSupabaseAdminClient();
  const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from("project_secrets")
    .select("project_id, meta_token_expires_at")
    .lt("meta_token_expires_at", sevenDaysOut)
    .not("meta_token_secret_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const refreshed: Array<{ projectId: string; status: "ok" | "fail"; reason?: string }> = [];
  for (const row of rows ?? []) {
    try {
      const token = await getProjectSecret(row.project_id, "meta");
      if (!token) {
        refreshed.push({ projectId: row.project_id, status: "fail", reason: "missing token" });
        continue;
      }
      const next = await refreshLongLivedToken(token);
      await setProjectSecret(row.project_id, "meta", next.access_token);
      const expiresAt = new Date(Date.now() + next.expires_in * 1000).toISOString();
      await admin
        .from("project_secrets")
        .update({ meta_token_expires_at: expiresAt })
        .eq("project_id", row.project_id);
      refreshed.push({ projectId: row.project_id, status: "ok" });
    } catch (e) {
      refreshed.push({
        projectId: row.project_id,
        status: "fail",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ checked: rows?.length ?? 0, results: refreshed });
}
