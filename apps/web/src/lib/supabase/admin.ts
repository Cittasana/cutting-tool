import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Bypasses RLS — only call from server-side
 * code that has already authorized the operation (e.g. API routes that
 * verified the user via getSupabaseServerClient first).
 *
 * Required env: SUPABASE_SERVICE_ROLE_KEY
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Service-role client unavailable: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

/**
 * Retrieve a decrypted tenant-level secret. Service-role only.
 */
export async function getTenantSecret(
  tenantId: string,
  kind: "anthropic",
): Promise<string | null> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_tenant_secret", {
    p_tenant_id: tenantId,
    p_kind: kind,
  });
  if (error) throw new Error(`get_tenant_secret(${kind}): ${error.message}`);
  return (data as string | null) ?? null;
}

export async function getProjectSecret(
  projectId: string,
  kind: "anthropic" | "elevenlabs" | "higgsfield" | "meta",
): Promise<string | null> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_project_secret", {
    p_project_id: projectId,
    p_kind: kind,
  });
  if (error) throw new Error(`get_project_secret(${kind}): ${error.message}`);
  return (data as string | null) ?? null;
}

/**
 * Anthropic key resolution: project-level override falls back to tenant-level.
 */
export async function resolveAnthropicKey(
  tenantId: string,
  projectId: string,
): Promise<string> {
  const projectKey = await getProjectSecret(projectId, "anthropic");
  if (projectKey) return projectKey;
  const tenantKey = await getTenantSecret(tenantId, "anthropic");
  if (!tenantKey) {
    throw new Error(
      "No Anthropic API key configured. Set one in /settings (tenant) or /projects/[id]/keys (project override).",
    );
  }
  return tenantKey;
}
