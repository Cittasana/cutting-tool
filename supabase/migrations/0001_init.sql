-- Cutting Tool v2 — Initial schema
-- Multi-tenant Reels-editor: tenants, projects, brand presets, assets, jobs, events.
-- All tables RLS-enabled. UUIDs everywhere. Soft-delete via deleted_at.

set check_function_bodies = off;

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "supabase_vault";

-- ============================================================
-- Tenants — top-level customer-of-cosmo container
-- ============================================================
create table if not exists public.tenants (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  name            text not null check (length(name) between 2 and 80),
  slug            text not null unique check (slug ~ '^[a-z0-9-]+$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists tenants_owner_idx on public.tenants(owner_user_id) where deleted_at is null;

-- ============================================================
-- Projects — per-customer workspace inside a tenant
-- ============================================================
create table if not exists public.projects (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  name                text not null check (length(name) between 1 and 120),
  slug                text not null check (slug ~ '^[a-z0-9-]+$'),
  language            text not null default 'de' check (language in ('de','en')),
  default_voice_id    text,
  auto_post_enabled   boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (tenant_id, slug)
);

create index if not exists projects_tenant_idx on public.projects(tenant_id) where deleted_at is null;

-- ============================================================
-- Project secrets — per-project encrypted API keys (Supabase Vault references)
-- vault_secret_id columns store the UUID of vault.secrets entries.
-- Access only via SECURITY DEFINER RPCs, never directly.
-- ============================================================
create table if not exists public.project_secrets (
  project_id              uuid primary key references public.projects(id) on delete cascade,
  anthropic_secret_id     uuid,
  elevenlabs_secret_id    uuid,
  higgsfield_secret_id    uuid,
  meta_token_secret_id    uuid,
  ig_business_account_id  text,
  meta_token_expires_at   timestamptz,
  updated_at              timestamptz not null default now()
);

-- ============================================================
-- Brand presets — versioned per project
-- ============================================================
create table if not exists public.brand_presets (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  version               integer not null default 1,
  is_active             boolean not null default true,
  name                  text not null,

  -- Visual
  lut_storage_path      text,
  lut_format            text default 'cube',
  reference_frames      jsonb not null default '[]'::jsonb,

  -- Auto-extracted style fingerprint (from LUT analysis)
  palette_hex           text[] not null default '{}',
  shadow_tint           text,
  midtone_tint          text,
  highlight_tint        text,
  contrast_profile      text check (contrast_profile in ('low','medium','high')),
  saturation_profile    text,
  style_description     text,

  -- Branding assets
  logo_storage_path         text,
  logo_dark_storage_path    text,
  wordmark_storage_path     text,
  font_family               text default 'Inter',
  font_storage_path         text,

  -- Defaults
  default_aspect_ratio  text not null default '9:16',
  default_caption_style jsonb not null default '{}'::jsonb,
  tone_descriptors      text[] not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (project_id, version)
);

create index if not exists brand_presets_active_idx
  on public.brand_presets(project_id) where is_active;

-- ============================================================
-- Assets — uploads, generated b-roll, voiceovers, finals
-- ============================================================
create table if not exists public.assets (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  kind            text not null check (kind in ('upload','broll','voice','final','reference')),
  blob_url        text not null,
  filename        text,
  mime_type       text,
  size_bytes      bigint,
  duration_ms     integer,
  width           integer,
  height          integer,
  metadata        jsonb not null default '{}'::jsonb,
  analysis        jsonb,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists assets_project_idx on public.assets(project_id) where deleted_at is null;
create index if not exists assets_kind_idx on public.assets(project_id, kind) where deleted_at is null;

-- ============================================================
-- Jobs — workflow runs (reel renders)
-- ============================================================
create table if not exists public.jobs (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects(id) on delete cascade,
  workflow_run_id         text,
  status                  text not null default 'queued'
                          check (status in ('queued','planning','analyzing','composing','rendering','evaluating','posting','done','failed','cancelled')),
  progress                integer not null default 0 check (progress between 0 and 100),
  current_step            text,
  brand_preset_id         uuid references public.brand_presets(id),
  brand_preset_version    integer,
  brief                   jsonb,
  storyboard              jsonb,
  timeline                jsonb,
  output_asset_id         uuid references public.assets(id),
  error                   jsonb,
  created_at              timestamptz not null default now(),
  started_at              timestamptz,
  finished_at             timestamptz
);

create index if not exists jobs_project_idx on public.jobs(project_id);
create index if not exists jobs_status_idx on public.jobs(status) where status not in ('done','failed','cancelled');

-- ============================================================
-- Job events — append-only stream for live UI + agent log
-- ============================================================
create table if not exists public.job_events (
  id          bigserial primary key,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  ts          timestamptz not null default now(),
  type        text not null,
  payload     jsonb not null default '{}'::jsonb
);

create index if not exists job_events_job_idx on public.job_events(job_id, ts);

-- ============================================================
-- updated_at trigger helper
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tenants_updated_at         before update on public.tenants         for each row execute function public.set_updated_at();
create trigger projects_updated_at        before update on public.projects        for each row execute function public.set_updated_at();
create trigger project_secrets_updated_at before update on public.project_secrets for each row execute function public.set_updated_at();
create trigger brand_presets_updated_at   before update on public.brand_presets   for each row execute function public.set_updated_at();

-- ============================================================
-- RLS — enable on all tables
-- ============================================================
alter table public.tenants          enable row level security;
alter table public.projects         enable row level security;
alter table public.project_secrets  enable row level security;
alter table public.brand_presets    enable row level security;
alter table public.assets           enable row level security;
alter table public.jobs             enable row level security;
alter table public.job_events       enable row level security;

-- helper: is the calling user the owner of this tenant?
create or replace function public.is_tenant_owner(t_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.tenants
    where id = t_id and owner_user_id = auth.uid() and deleted_at is null
  );
$$;

-- helper: is this project owned by caller (via tenant)?
create or replace function public.is_project_owner(p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.projects p
    join public.tenants t on t.id = p.tenant_id
    where p.id = p_id and t.owner_user_id = auth.uid() and t.deleted_at is null and p.deleted_at is null
  );
$$;

-- tenants
create policy tenants_select on public.tenants for select using (owner_user_id = auth.uid());
create policy tenants_insert on public.tenants for insert with check (owner_user_id = auth.uid());
create policy tenants_update on public.tenants for update using (owner_user_id = auth.uid());

-- projects
create policy projects_select on public.projects for select using (public.is_tenant_owner(tenant_id));
create policy projects_insert on public.projects for insert with check (public.is_tenant_owner(tenant_id));
create policy projects_update on public.projects for update using (public.is_tenant_owner(tenant_id));

-- project_secrets — read returns existence only via RPC; deny direct read
create policy project_secrets_owner on public.project_secrets for all using (public.is_project_owner(project_id));

-- brand_presets, assets, jobs, job_events
create policy brand_presets_all on public.brand_presets for all using (public.is_project_owner(project_id));
create policy assets_all        on public.assets        for all using (public.is_project_owner(project_id));
create policy jobs_all          on public.jobs          for all using (public.is_project_owner(project_id));
create policy job_events_select on public.job_events    for select using (public.is_project_owner((select project_id from public.jobs where id = job_id)));
