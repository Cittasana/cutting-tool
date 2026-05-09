# Cutting Tool v2 — Architecture & Scope

**Stand:** 2026-05-09 · **Author:** Cosmo Graef + Claude · **Status:** Proposal, awaiting approval

---

## 0. Was wir bauen (Executive Summary)

V1 ist ein lokales CLI das aus einer Produkt-URL einen Reel rein KI-generativ baut.
V2 ist eine **Multi-Tenant Vercel-SaaS-App** in der Cosmo (und später Kunden) Projekte anlegen, eigene Footage hochladen oder per KI generieren, mit eigenem Brand-Look (LUT, Voice, Logo, Schrift) automatisch schneiden und direkt nach Instagram publishen können — orchestriert durch mehrere Claude-Agenten, die ihre Schritte live im UI sichtbar machen.

CLI bleibt als Power-Tool/Smoke-Pfad bestehen.

---

## 1. Was bleibt aus v1

- Marketing-Brief-Agent (Claude Sonnet 4.6, Tool-Use, structured output)
- Storyboard-Agent (Hard-Constraints, Validator, Retry-Loop)
- Scene-Eval & Final-Eval-Agent (Vision-QC mit Auto-Retry)
- Higgsfield-Runner (Veo 3.1 Fast / Seedance 2.0)
- ElevenLabs-TTS-Runner
- ffmpeg-Pipeline für Overlay/Mux/Concat
- @resvg/resvg-js Text-Renderer
- Asset-Registry (Fonts/Icons)
- Zod-Schemas + Storyboard-Validator
- Eval-Schwellen + Retry-Caps

Wird in v2 in TypeScript-Workflows als wiederverwendbare Steps gewrapped.

---

## 2. Was neu kommt (Scope v2)

### 2.1 Upload-Pipeline (Drag-Drop)
- Browser direct-upload zu **Vercel Blob** via `@vercel/blob/client` (multipart bis 5 TB)
- Pre-Validation client-side: Codec, Größe, Duration
- Resumable bei Disconnect

### 2.2 Cutting-Agent (NEU)
Macht aus Roh-Footage einen geschnittenen Reel — sieben Schritte:

| # | Schritt | Tooling | Wer entscheidet |
|---|---|---|---|
| 1 | Probe & Color-Detect | `ffprobe` | deterministisch |
| 2 | Scene-Detection | `PySceneDetect 0.7 AdaptiveDetector` | deterministisch |
| 3 | Audio-Analyse | `silero-vad` + `WhisperX` (word-timestamps) + `madmom` (beats/downbeats) + `inaSpeechSegmenter` (speech/music) | deterministisch |
| 4 | Visual-Analyse | `Farneback` motion-score, `MediaPipe FaceMesh` (Talking-Head-Detection via MAR), `Katna` keyframes | deterministisch |
| 5 | Manifest-Build | JSON pro Asset: `{scenes, transcript_words, beats, motion_curve, faces, thumbnails}` | deterministisch |
| 6 | LLM-Composition (3 Stages) | Claude Sonnet 4.6 + Haiku 4.5 für Tagging | **Cutting-Agent** entscheidet kreativ |
| 7 | Render | ffmpeg + Remotion in **Vercel Sandbox** | deterministisch |

**LLM-Stages:**
- Stage 1 (Haiku, parallel): Pro Szene 4 Thumbnails + Transcript-Snippet → Tags, Sentiment, `good_for_reel: bool`. Gecached.
- Stage 2 (Sonnet, extended thinking): Komprimiertes Manifest + Beat-Grid + Music-Energy → Timeline-JSON.
- Stage 3 (Sonnet, parallel): Captions pro Cut + B-Roll-Prompts wenn Lücken.

**Snap-Logic:** LLM gibt Cut-Intent ("snap to nearest downbeat ±200ms" oder "cut on word-boundary"). Renderer snapped präzise. LLM muss nicht millisekunden-genau sein.

**B-Roll-Lücken:** LLM darf Stock-Lib-Lookup oder Higgsfield-Trigger anfordern. Hybrid: Upload-Material als Hauptträger, Higgsfield-B-Roll fillt Pacing-Lücken oder Cover-Cuts.

### 2.3 Brand-Preset / LUT-System (NEU)
Pro Projekt ein versioniertes **Brand-Preset** mit:
- `.cube` LUT (Size 33, 3D, tetrahedral interp)
- Reference-Frames (1–3 Bilder die den Look definieren)
- Logo + Wordmark + Dark-Variant
- Custom-Font (TTF/OTF Upload)
- Color-Palette (auto-extrahiert aus LUT via `colour-science` + `colorthief`)
- Style-Description (auto-generiert aus LUT für Higgsfield-Prompts)
- Default Voice-ID (ElevenLabs)
- Caption-Style-Defaults

**Append-only Versioning:** Edit erzeugt `version+1`, alte Versionen bleiben. Reels speichern `(preset_id, version)` → Re-Render Monate später identisch reproduzierbar.

**Apply-Pipeline (auf User-Upload):**
```
Upload
 → ffprobe + heuristic (sRGB? Log? Display-P3?)
 → colorspace filter (normalize zu Rec.709 limited)
 → optional Tech-LUT (S-Log3 → Rec.709 wenn nötig)
 → eq/normalize (auto-WB/Belichtung, smoothing=15)
 → colorchannelmixer (3×3-Matrix aus color-matcher MKL gegen Reference)
 → lut3d=brand.cube:interp=tetrahedral
 → 1080×1920 9:16, 30fps, H.264, bt709-tagged
```

**Apply-Pipeline (auf Higgsfield-Generation):**
```
Build Higgsfield-Prompt
 + Style-Description aus LUT (palette + tints + contrast)
 + Style-Reference-Image: brand.cube auf neutralem Test-Frame angewendet, hochgeladen als Higgsfield reference_image_id
 → Veo 3.1 Fast / Seedance 2.0 generation
 → Output: defensives bt709-Tagging
 → SAME lut3d=brand.cube applied (Safety-Net gegen Drift)
 → Pipeline ab "1080×1920" identisch zu Upload-Pfad
```

**Default-LUTs out-of-the-box** (eigene MIT-lizenzierte `.cube`-Files):
1. Neutral / Documentary
2. Warm Editorial (Lifestyle/Coaching)
3. Cool Modern (SaaS/Tech)
4. Filmic Teal-Orange (Premium)

### 2.4 Multi-Tenant / Multi-Customer (NEU)
- **Tenants** (= Cosmo) haben **N Projekte**
- Pro Projekt eigene Secrets (Anthropic, ElevenLabs, Meta-Token, optional Higgsfield)
- Pro Projekt eigenes Brand-Preset
- Pro Projekt eigene Voice-Konfiguration
- Auto-Posting opt-in pro Projekt

### 2.5 Auto-Posting (NEU)
- Facebook OAuth-Login pro Projekt → long-lived 60d-Token
- **Reels Container-API** (zwei-stufig: `/media` → poll status → `/media_publish`)
- Cron auf Vercel refresht Tokens älter als 24h (vor 60d-Ablauf)
- Webhook `instagram` für Comment/Mention-Events optional

### 2.6 AgenticOS-Integration (NEU)
- **Vercel-gehosteter MCP-Server** im selben Repo via `@vercel/mcp-adapter`
- Tools: `list_projects`, `start_render`, `subscribe_job_events`, `get_brand_preset`, `upload_asset`
- OAuth pro Tenant
- Externe Agents (Cosmo's andere Projekte, Cursor, Claude Desktop) können live mitschauen + auf der Plattform mitarbeiten

### 2.7 Live-Status-UI (NEU)
- Job-Detail-Page zeigt:
  - Aktueller Workflow-Step ("Cutting-Agent denkt nach", "Scene 3/8 wird gerendert")
  - Live-Frame-Previews während Higgsfield-Generation
  - Agent-Thoughts (Claude's reasoning per step)
  - Progress-Bar
- Realtime via **Supabase Broadcast** (nicht postgres_changes — skaliert besser)

---

## 3. Tech-Stack (final)

| Layer | Choice | Reasoning |
|---|---|---|
| Frontend | **Next.js 16 App Router auf Vercel** | Server Components, Cache Components, Fluid Compute |
| Auth | **Supabase Auth** | Bestehende Infra wiederverwenden |
| API/Edge | **Vercel Functions** (Fluid Compute, Node 24) | 800s Timeout reicht für Orchestration-Endpoints |
| Job-Orchestrator | **Vercel Workflows (WDK, GA)** | `'use workflow'`, durable, `sleep()` ist gratis, Higgsfield-Webhook → Resume |
| Heavy Render | **Vercel Sandbox** (Firecracker μVM) | 5 h Timeout Pro, 8 vCPU, 16 GB RAM, `dnf install ffmpeg`, Active-CPU-Pricing |
| Datenbank | **Supabase Postgres** | RLS, Realtime, Vault — bestehende Infra |
| Per-Projekt-Secrets | **Supabase Vault** | libsodium AEAD, transparent, Postgres-native |
| Object Storage | **Vercel Blob** (public + private) | 5 TB max, multipart, $0.023/GB-Monat |
| Realtime UI | **Supabase Broadcast** | empfohlen über postgres_changes |
| Posting | **Meta Graph API** Reels Container | offizieller IG-Pfad |
| MCP | **`@vercel/mcp-adapter`** Streamable HTTP | OAuth out-of-the-box |
| Cutting-Agent Pre-Analyse | **Python in Vercel Sandbox** | scenedetect, whisperx, madmom, mediapipe, katna, color-matcher, colour-science |

**Geschätzte Plattform-Kosten** bei 100 aktiven Usern, 500 Renders/Monat: **~$60–80/Monat fix** (Vercel Pro $20 + Sandbox ~$11 + Blob ~$3 + Supabase Pro $25). Lineare Skalierung mit Render-Volumen.

---

## 4. Datenmodell

```sql
tenants (id, owner_user_id, name, created_at)
projects (id, tenant_id, name, brand_preset_id, default_voice_id, auto_post_enabled, created_at, deleted_at)
project_secrets (project_id PK, anthropic_key_vault_id, elevenlabs_key_vault_id, meta_token_vault_id, higgsfield_key_vault_id, ig_business_account_id, meta_token_expires_at)
brand_presets (id, project_id, version, is_active, lut_path, reference_frames jsonb, palette_hex[], style_description, logo_path, font_path, voice_id, caption_style jsonb, created_at)
assets (id, project_id, kind ['upload','broll','voice','final'], blob_url, duration_ms, w, h, metadata jsonb, analysis jsonb, created_at)
jobs (id, project_id, workflow_run_id, status, progress, current_step, error jsonb, output_asset_id, brand_preset_id, brand_preset_version, brief jsonb, storyboard jsonb, created_at, finished_at)
job_events (id bigserial, job_id, ts, type ['step.started','scene.preview','agent.thought','progress'], payload jsonb)
```

RLS auf allen Tabellen. UUIDs überall (außer job_events.id für Insert-Performance). Soft-Delete via `deleted_at`. Append-only Versioning bei `brand_presets`.

---

## 5. Pipeline-Topologie

```
                  BROWSER (drag-drop, project picker, settings)
                            │
                ┌───────────┼───────────────────────────────────┐
                │           │                                   │
   multipart upload    POST /api/jobs/start            Realtime Broadcast
   (Vercel Blob)              │                          (Supabase)
                              ▼
                   Vercel Function: starts Workflow
                              │
                              ▼
                  ╔═════════════════════════════╗
                  ║  Vercel Workflow (durable)   ║
                  ║                              ║
                  ║  1. plan(brief)              ║──▶ Claude (brief + storyboard)
                  ║  2. analyze(uploads)         ║──▶ Vercel Sandbox (scenedetect/whisperx/...)
                  ║  3. compose(manifest, brand) ║──▶ Claude (3-stage: tag/compose/polish)
                  ║  4. fill(broll-gaps)         ║──▶ Higgsfield (webhook-resume!)
                  ║  5. tts(voiceover)           ║──▶ ElevenLabs
                  ║  6. render(timeline+lut)     ║──▶ Vercel Sandbox (ffmpeg + remotion)
                  ║  7. eval(final)              ║──▶ Claude (vision)
                  ║  8. post(meta)               ║──▶ Meta Graph (optional)
                  ║                              ║
                  ║  jeder step pusht event      ║
                  ║  → Supabase Broadcast        ║
                  ╚═════════════════════════════╝
                              │
                              ▼
                          Final reel.mp4 in Blob
                          + post-receipt in jobs
```

Alle Steps sind crash-safe. Higgsfield-Wartezeit konsumiert keine Compute (Webhook-Resume + Active-CPU-Pricing).

---

## 6. UI-Sketch (high-level)

```
┌──────────────────────────────────────────────────────────────┐
│ [Logo]  Projekte  Settings              [user@cittasana.de] │
├──────────────────────────────────────────────────────────────┤
│  PROJEKTE                                  [+ Neues Projekt] │
│  ┌─ Cittasana Webinar ─────────── 12 Reels · IG verbunden ┐ │
│  │  Brand: Filmic Teal-Orange · Voice: Anna (DE)           │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─ Kunde Müller GmbH ─────────── 3 Reels · IG verbunden ──┐ │
│  │  Brand: Custom (custom.cube) · Voice: Custom-Klon       │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

PROJEKT-DETAIL:
┌──────────────────────────────────────────────────────────────┐
│ Kunde Müller GmbH                                            │
├──────────────────────────────────────────────────────────────┤
│ [Reels] [Brand] [Assets] [Auto-Post] [Keys]                  │
├──────────────────────────────────────────────────────────────┤
│  NEUER REEL                                                  │
│  ╭──────────────────────────────────────────╮                │
│  │  Drag & Drop Videos/Fotos hier hin       │                │
│  │  oder URL für reine KI-Generierung       │                │
│  ╰──────────────────────────────────────────╯                │
│                                                              │
│  Cutting-Agent-Modus:                                        │
│   ( ) Auto (Agent entscheidet alles)                         │
│   (•) Geführt (du wählst Vibe + Pacing)                      │
│   ( ) Manuell (Storyboard-Review)                            │
│                                                              │
│  Länge: [30s] [60s]    Sprache: [DE] [EN]                    │
│                                                              │
│  [Reel generieren]                                           │
└──────────────────────────────────────────────────────────────┘

LIVE-JOB-VIEW:
┌──────────────────────────────────────────────────────────────┐
│ Job #a8f3 · "Sommer-Reel" · läuft seit 4:23 min              │
├──────────────────────────────────────────────────────────────┤
│ ✓ Brief erstellt                                             │
│ ✓ Upload analysiert (12 Szenen, 3:42 Material)               │
│ ▶ Cutting-Agent komponiert Timeline...                       │
│   "Setze Hook bei Sek 0.4, snappt auf Downbeat 1.   "      │
│ ◯ B-Roll-Lücken füllen                                       │
│ ◯ Voiceover                                                  │
│ ◯ Render                                                     │
│ ◯ Final-Eval                                                 │
│                                                              │
│ [Live-Frames]  [Agent-Log]  [Abbrechen]                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Phased Rollout

### Phase 0 — Foundation (1 Woche)
- Supabase-Schema + Migrations + RLS
- Next.js-Projekt scaffold (App Router, Tailwind, shadcn/ui)
- Supabase Auth + Tenant-Onboarding
- Settings-Tab (Anthropic-Key auf Tenant-Level)
- Projekt-CRUD

### Phase 1 — KI-Generierung-Parität (1 Woche)
Bestehende v1-Pipeline nach Vercel migriert:
- Workflow-skeleton mit `'use workflow'`/`'use step'`
- Brief + Storyboard + Higgsfield + ElevenLabs + Render-Steps
- Vercel Sandbox-Image mit ffmpeg + node + tsx
- Realtime-Broadcast an UI

→ **Demo:** "Reel aus URL" funktioniert wieder, jetzt im Browser sichtbar.

### Phase 2 — Brand-Preset + LUT (1 Woche)
- Brand-Preset-Schema + UI (Upload `.cube` + Reference-Frames + Logo + Font + Voice-ID)
- LUT-Analyse-Service (Python in Sandbox: `colour-science` + `colorthief` extrahiert Palette + Style-Description)
- ffmpeg-Pipeline um `colorspace`+`lut3d` erweitert
- Style-Reference-Image-Build (LUT auf Test-Frame, Upload zu Higgsfield als reference_image)
- Higgsfield-Prompts mit Style-Block automatisch erweitert
- 4 Default-LUTs out-of-the-box

→ **Demo:** Reel mit Custom-LUT vs ohne — sichtbarer Brand-Look.

### Phase 3 — Upload + Cutting-Agent (2 Wochen — größtes Stück)
- Vercel Blob client direct upload
- Pre-Analyse-Service in Sandbox (scenedetect, whisperx, madmom, mediapipe, katna, color-matcher)
- Cutting-Agent (3-Stage Claude-Pipeline)
- Timeline-JSON-Schema + Validator
- Render-Pipeline: trim + reframe + concat + audio-mix + caption-overlay + LUT
- Snap-to-beat + snap-to-word Logic im Renderer

→ **Demo:** User lädt iPhone-Footage hoch, bekommt geschnittenen Reel mit Brand-LUT.

### Phase 4 — Auto-Posting (1 Woche)
- Facebook-Login pro Projekt
- Token-Refresh Cron
- Reels Container API + Polling-Step
- Webhook für Post-Status
- Auto-Post-Toggle pro Job

### Phase 5 — AgenticOS / MCP (1 Woche)
- `@vercel/mcp-adapter` Setup
- 5–7 MCP-Tools
- OAuth-Flow für externe Agents
- Live-Event-Subscription

### Phase 6 — Polish + Out-of-Scope-Items aus v1
- xfade-Transitions
- Background-Music (mit ducking)
- Auto-Subtitles aus VO
- Cover-/Thumbnail-Generator
- Mehr Aspect Ratios (1:1, 16:9 für YouTube Shorts)

**Realistisch:** ~8 Wochen Solo, könnte parallel in 5 Wochen mit dedizierten Sprints. Phase 0+1 sind Voraussetzung; ab Phase 2 lieferbar.

---

## 8. Entscheidungen (committed 2026-05-09)

1. **Datenbank:** ✅ Neues Supabase-Projekt für Cutting-Tool — saubere Trennung von Cittasana OS.
2. **Phase-Priorität:** ✅ KI-Parität zuerst (Phase 1 → 2 → 3).
3. **Higgsfield:** ✅ Direct HTTP API — keine CLI-Dependency mehr, `higgsfield.ts` wird neu geschrieben gegen die offizielle API.
4. **CLI-v1:** ✅ Wird komplett auf Web migriert — v1-CLI wird deprecated, Code-Logik wandert in Vercel-Workflows. Keine doppelte Pflege.
5. **Pre-Analyse Stack:** Python (scenedetect/whisperx/madmom/mediapipe/katna/color-matcher/colour-science) — keine Node-Äquivalente vorhanden.
6. **Render-Engine:** Hybrid — ffmpeg für Cuts/Concat/LUT/Mux, Remotion für Captions + Lower-Thirds + komplexe Composition-Layer.
7. **Auth-Schema:** Multi-User-fähig von Tag 1 (`tenants` + `auth.users` join), UI erst später ausbauen.

### Noch offen
- **Domain:** Subdomain `cutting.cittasana.de` ODER eigene Marke?
- **Daten-Migration v1 → v2:** Bestehende v1-Output-Files migrieren oder v2 leer starten?

---

## 9. Risiken

| Risiko | Mitigation |
|---|---|
| Higgsfield-CLI auf Sandbox flaky | Direct-HTTP-Auth implementieren, CLI-Dep eliminieren |
| Vercel-Sandbox-Cold-Start zu langsam für UX | Pre-warm Pool oder Workflow-Heartbeat |
| ffmpeg in Sandbox (musl-Variante) inkompatibel | Static-Build von johnvansickle.com mitliefern |
| Whisper/madmom/mediapipe in Sandbox sind groß (~3GB) | Image-Layer-Caching, oder Python-Service als separater Worker |
| Meta-API Token-Expiry zerstört Auto-Post | Cron-Refresh + Status-Banner im UI bei Token-Issues |
| Multi-Tenant Secret-Leakage durch Bug | Supabase Vault + RLS-Policies + Audit-Logs |
| Brand-LUT-Lizenzen (Default-LUTs) | Eigene MIT-LUTs in DaVinci nodebauen |
| Color-Drift zwischen Upload und Higgsfield-Output | Mandatory Post-LUT auf beidem (Safety-Net erzwingen) |

---

## 10. Out-of-Scope für v2.0 (kommt in v2.1+)

- Multi-Account-Posting (TikTok, YouTube Shorts, LinkedIn) — nur IG zuerst
- A/B-Variant-Generation (mehrere Reel-Versionen pro Brief)
- Stock-Footage-Library-Integration (Pexels, Storyblocks API)
- Custom-Voice-Cloning-UI (User clont eigene Stimme im Tool) — derzeit nur ID hinterlegen
- Team-Collaboration (Kommentare auf Drafts)
- Analytics (welcher Reel performed wie)
- Scheduling (Post in 3 Tagen)
- Webhook-Integrationen für n8n/Zapier
- Mobile-App
- Eigene Render-GPU (für Custom-Models)

---

**Nächster Schritt:** Antworten auf §8, dann Phase 0 + 1 starten.
