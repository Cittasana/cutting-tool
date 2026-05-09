import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase/admin";

export interface McpTokenContext {
  tokenId: string;
  userId: string;
  scopes: string[];
}

export function generateMcpToken(): { plaintext: string; hash: string; prefix: string } {
  const raw = randomBytes(32).toString("base64url");
  const plaintext = `ct_mcp_${raw}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const prefix = plaintext.slice(0, 12);
  return { plaintext, hash, prefix };
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Validate a Bearer token from MCP request headers and resolve to an
 * McpTokenContext. Returns null when invalid/revoked.
 *
 * Side-effect: bumps last_used_at via touch_mcp_token RPC (admin-only).
 */
export async function authenticateMcpRequest(
  request: Request,
): Promise<McpTokenContext | null> {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(ct_mcp_[A-Za-z0-9_-]+)$/);
  if (!match) return null;
  const plaintext = match[1]!;
  const hash = hashToken(plaintext);

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("mcp_tokens")
    .select("id, user_id, scopes, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) return null;
  if (data.revoked_at) return null;

  await admin.rpc("touch_mcp_token", { p_token_hash: hash });

  return {
    tokenId: data.id,
    userId: data.user_id,
    scopes: data.scopes ?? [],
  };
}

/**
 * Server-side Supabase admin scoped to a specific user. Use after
 * authenticateMcpRequest succeeds — RLS is bypassed but query
 * predicates still constrain to that user.
 */
export function buildOwnedFilter(userId: string) {
  return { user_id: userId };
}
