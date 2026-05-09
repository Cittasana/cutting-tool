-- Per-tenant + per-project secrets via Supabase Vault.
-- All access goes through SECURITY DEFINER RPCs that re-check ownership.
-- Vault secrets are referenced by UUID; raw values never leave the database
-- except via get_*_secret() (called only from server-side workflow code).

-- ============================================================
-- Tenant-level secrets (e.g. cosmo's Anthropic API key)
-- ============================================================
create table if not exists public.tenant_secrets (
  tenant_id              uuid primary key references public.tenants(id) on delete cascade,
  anthropic_secret_id    uuid,
  updated_at             timestamptz not null default now()
);

alter table public.tenant_secrets enable row level security;

create policy tenant_secrets_owner on public.tenant_secrets
  for all using (public.is_tenant_owner(tenant_id));

create trigger tenant_secrets_updated_at
  before update on public.tenant_secrets
  for each row execute function public.set_updated_at();

-- ============================================================
-- Set / rotate a tenant-level secret.
-- Returns nothing (success = no exception).
-- ============================================================
create or replace function public.set_tenant_secret(
  p_tenant_id uuid,
  p_kind text,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret_id uuid;
  v_existing  uuid;
begin
  if not public.is_tenant_owner(p_tenant_id) then
    raise exception 'forbidden';
  end if;
  if p_kind not in ('anthropic') then
    raise exception 'unsupported tenant secret kind: %', p_kind;
  end if;

  insert into public.tenant_secrets (tenant_id) values (p_tenant_id)
    on conflict (tenant_id) do nothing;

  select case p_kind when 'anthropic' then anthropic_secret_id end
    into v_existing
    from public.tenant_secrets where tenant_id = p_tenant_id;

  if v_existing is not null then
    perform vault.update_secret(v_existing, p_value);
    v_secret_id := v_existing;
  else
    v_secret_id := vault.create_secret(
      p_value,
      'tenant_' || p_tenant_id::text || '_' || p_kind
    );
    update public.tenant_secrets
      set anthropic_secret_id = case when p_kind = 'anthropic' then v_secret_id end
      where tenant_id = p_tenant_id;
  end if;
end;
$$;

-- ============================================================
-- Set / rotate a project-level secret.
-- ============================================================
create or replace function public.set_project_secret(
  p_project_id uuid,
  p_kind text,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing  uuid;
  v_secret_id uuid;
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'forbidden';
  end if;
  if p_kind not in ('anthropic','elevenlabs','higgsfield','meta') then
    raise exception 'unsupported project secret kind: %', p_kind;
  end if;

  insert into public.project_secrets (project_id) values (p_project_id)
    on conflict (project_id) do nothing;

  select case p_kind
    when 'anthropic'  then anthropic_secret_id
    when 'elevenlabs' then elevenlabs_secret_id
    when 'higgsfield' then higgsfield_secret_id
    when 'meta'       then meta_token_secret_id
  end
    into v_existing
    from public.project_secrets where project_id = p_project_id;

  if v_existing is not null then
    perform vault.update_secret(v_existing, p_value);
    v_secret_id := v_existing;
  else
    v_secret_id := vault.create_secret(
      p_value,
      'project_' || p_project_id::text || '_' || p_kind
    );
    update public.project_secrets set
      anthropic_secret_id  = case when p_kind = 'anthropic'  then v_secret_id else anthropic_secret_id end,
      elevenlabs_secret_id = case when p_kind = 'elevenlabs' then v_secret_id else elevenlabs_secret_id end,
      higgsfield_secret_id = case when p_kind = 'higgsfield' then v_secret_id else higgsfield_secret_id end,
      meta_token_secret_id = case when p_kind = 'meta'       then v_secret_id else meta_token_secret_id end
      where project_id = p_project_id;
  end if;
end;
$$;

-- ============================================================
-- Server-only: read a decrypted secret. Called from workflow steps
-- using the service-role client. No RLS check here — the caller is trusted server code.
-- ============================================================
create or replace function public.get_tenant_secret(p_tenant_id uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_value text;
begin
  select case p_kind when 'anthropic' then anthropic_secret_id end
    into v_id from public.tenant_secrets where tenant_id = p_tenant_id;
  if v_id is null then return null; end if;
  select decrypted_secret into v_value from vault.decrypted_secrets where id = v_id;
  return v_value;
end;
$$;

create or replace function public.get_project_secret(p_project_id uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_value text;
begin
  select case p_kind
    when 'anthropic'  then anthropic_secret_id
    when 'elevenlabs' then elevenlabs_secret_id
    when 'higgsfield' then higgsfield_secret_id
    when 'meta'       then meta_token_secret_id
  end
    into v_id from public.project_secrets where project_id = p_project_id;
  if v_id is null then return null; end if;
  select decrypted_secret into v_value from vault.decrypted_secrets where id = v_id;
  return v_value;
end;
$$;

-- Restrict get_*_secret to service_role only — anon/authenticated must not call these.
revoke execute on function public.get_tenant_secret(uuid, text)  from public, anon, authenticated;
revoke execute on function public.get_project_secret(uuid, text) from public, anon, authenticated;
grant  execute on function public.get_tenant_secret(uuid, text)  to service_role;
grant  execute on function public.get_project_secret(uuid, text) to service_role;

-- ============================================================
-- Existence helpers (safe for client to know "is the key set?")
-- ============================================================
create or replace function public.tenant_secret_exists(p_tenant_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.is_tenant_owner(p_tenant_id) then false
    when p_kind = 'anthropic' then exists (
      select 1 from public.tenant_secrets where tenant_id = p_tenant_id and anthropic_secret_id is not null
    )
    else false
  end;
$$;

create or replace function public.project_secret_exists(p_project_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.is_project_owner(p_project_id) then false
    when p_kind = 'anthropic'  then exists (select 1 from public.project_secrets where project_id = p_project_id and anthropic_secret_id  is not null)
    when p_kind = 'elevenlabs' then exists (select 1 from public.project_secrets where project_id = p_project_id and elevenlabs_secret_id is not null)
    when p_kind = 'higgsfield' then exists (select 1 from public.project_secrets where project_id = p_project_id and higgsfield_secret_id is not null)
    when p_kind = 'meta'       then exists (select 1 from public.project_secrets where project_id = p_project_id and meta_token_secret_id is not null)
    else false
  end;
$$;
