# Cutting Tool v2

Multi-tenant Reels-Editor SaaS. Drag-Drop Upload oder reine KI-Generierung, Brand-LUTs pro Projekt, Auto-Post zu Instagram, MCP-Integration für externe Agents.

**Status:** Phase 0 — Foundation. Architektur in [`SCOPE-V2.md`](./SCOPE-V2.md).

## Stack

- Next.js 16 App Router auf Vercel (Fluid Compute)
- Vercel Workflows (Orchestrator) + Vercel Sandbox (ffmpeg-Renders)
- Vercel Blob (Uploads bis 5 TB)
- Supabase (Postgres + Auth + Vault + Realtime Broadcast)
- Anthropic Claude Sonnet 4.6 + Haiku 4.5
- Higgsfield (Veo 3.1 Fast / Seedance 2.0) via Direct HTTP API
- ElevenLabs (TTS pro Projekt)
- Meta Graph API (Reels Container Publishing)

## Monorepo

```
apps/
├── web/          # Next.js 16 Frontend + API + MCP-Server
└── cli-legacy/   # v1 CLI — wird migriert, kein neuer Code
packages/
└── core/         # Geteilte Schemas, Agent-Prompts, ffmpeg-Helpers
supabase/
└── migrations/   # Schema-Migrations (RLS überall)
```

## Quick start (Phase 0 WIP)

```bash
pnpm install
pnpm dev
```

Voraussetzungen: Node 24+, pnpm 10+, Vercel CLI 53+, Supabase CLI.

## Domain

`cutting.cittasana.de` (geplant).
