-- MCP access tokens — per-user bearer tokens for the cutting-tool MCP server.
-- Token plaintext is shown ONCE at generation; only sha256(token) is stored.

create table if not exists public.mcp_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,                -- human label e.g. "Claude Desktop", "AIOS"
  token_hash      text not null unique,         -- sha256 hex of the bearer token
  prefix          text not null,                -- first 8 chars of the raw token (for display)
  scopes          text[] not null default '{read}',
  last_used_at    timestamptz,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);

create index if not exists mcp_tokens_user_idx on public.mcp_tokens(user_id) where revoked_at is null;
create index if not exists mcp_tokens_hash_idx on public.mcp_tokens(token_hash) where revoked_at is null;

alter table public.mcp_tokens enable row level security;

create policy mcp_tokens_owner on public.mcp_tokens
  for all using (user_id = auth.uid());

create or replace function public.touch_mcp_token(p_token_hash text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.mcp_tokens
  set last_used_at = now()
  where token_hash = p_token_hash and revoked_at is null;
$$;
revoke execute on function public.touch_mcp_token(text) from public, anon, authenticated;
grant  execute on function public.touch_mcp_token(text) to service_role;
