import { getSupabaseServerClient } from "./supabase/server";

export type TenantSecretKind = "anthropic";
export type ProjectSecretKind = "anthropic" | "elevenlabs" | "higgsfield" | "meta";

export async function setTenantSecret(
  tenantId: string,
  kind: TenantSecretKind,
  value: string,
): Promise<void> {
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("set_tenant_secret", {
    p_tenant_id: tenantId,
    p_kind: kind,
    p_value: value,
  });
  if (error) throw new Error(`set_tenant_secret(${kind}): ${error.message}`);
}

export async function setProjectSecret(
  projectId: string,
  kind: ProjectSecretKind,
  value: string,
): Promise<void> {
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("set_project_secret", {
    p_project_id: projectId,
    p_kind: kind,
    p_value: value,
  });
  if (error) throw new Error(`set_project_secret(${kind}): ${error.message}`);
}

export async function tenantSecretExists(
  tenantId: string,
  kind: TenantSecretKind,
): Promise<boolean> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc("tenant_secret_exists", {
    p_tenant_id: tenantId,
    p_kind: kind,
  });
  if (error) return false;
  return Boolean(data);
}

export async function projectSecretExists(
  projectId: string,
  kind: ProjectSecretKind,
): Promise<boolean> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc("project_secret_exists", {
    p_project_id: projectId,
    p_kind: kind,
  });
  if (error) return false;
  return Boolean(data);
}
