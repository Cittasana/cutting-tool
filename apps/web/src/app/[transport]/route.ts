import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import { authenticateMcpRequest } from "@/lib/mcp-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

function userId(extra: { authInfo?: AuthInfo }): string {
  const id = extra.authInfo?.extra?.userId;
  if (typeof id !== "string") throw new Error("missing auth context");
  return id;
}

const baseHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_projects",
      {
        title: "List Projects",
        description: "List all projects owned by the authenticated user.",
        inputSchema: {},
      },
      async (_args, extra: { authInfo?: AuthInfo }) => {
        const uid = userId(extra);
        const admin = getSupabaseAdminClient();
        const { data: tenants } = await admin
          .from("tenants")
          .select("id")
          .eq("owner_user_id", uid)
          .is("deleted_at", null);
        const { data, error } = await admin
          .from("projects")
          .select("id, name, slug, language, tenant_id, auto_post_enabled, created_at")
          .is("deleted_at", null)
          .in("tenant_id", (tenants ?? []).map((t) => t.id))
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        return { content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }] };
      },
    );

    server.registerTool(
      "get_project",
      {
        title: "Get Project",
        description: "Fetch a project by id with its active brand preset.",
        inputSchema: { project_id: z.string().uuid() },
      },
      async ({ project_id }, extra: { authInfo?: AuthInfo }) => {
        const uid = userId(extra);
        const admin = getSupabaseAdminClient();
        const { data: project } = await admin
          .from("projects")
          .select("id, name, slug, language, tenant_id, default_voice_id, auto_post_enabled, created_at")
          .eq("id", project_id)
          .is("deleted_at", null)
          .single();
        if (!project) throw new Error("project not found");
        const { data: tenant } = await admin
          .from("tenants")
          .select("id")
          .eq("id", project.tenant_id)
          .eq("owner_user_id", uid)
          .single();
        if (!tenant) throw new Error("forbidden");
        const { data: preset } = await admin
          .from("brand_presets")
          .select("id, version, palette_hex, style_description, lut_storage_path")
          .eq("project_id", project_id)
          .eq("is_active", true)
          .maybeSingle();
        return {
          content: [
            { type: "text", text: JSON.stringify({ project, brand_preset: preset }, null, 2) },
          ],
        };
      },
    );

    server.registerTool(
      "list_jobs",
      {
        title: "List Jobs",
        description: "List recent reel jobs for a project.",
        inputSchema: {
          project_id: z.string().uuid(),
          limit: z.number().int().min(1).max(100).default(20),
        },
      },
      async ({ project_id, limit }, extra: { authInfo?: AuthInfo }) => {
        userId(extra);
        const admin = getSupabaseAdminClient();
        const { data, error } = await admin
          .from("jobs")
          .select("id, status, progress, current_step, created_at, finished_at")
          .eq("project_id", project_id)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) throw new Error(error.message);
        return { content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }] };
      },
    );

    server.registerTool(
      "get_job",
      {
        title: "Get Job",
        description: "Fetch a single job's full state, including brief + storyboard + timeline.",
        inputSchema: { job_id: z.string().uuid() },
      },
      async ({ job_id }, extra: { authInfo?: AuthInfo }) => {
        userId(extra);
        const admin = getSupabaseAdminClient();
        const { data, error } = await admin.from("jobs").select("*").eq("id", job_id).single();
        if (error || !data) throw new Error("job not found");
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      },
    );

    server.registerTool(
      "list_assets",
      {
        title: "List Assets",
        description: "List uploaded assets for a project.",
        inputSchema: { project_id: z.string().uuid() },
      },
      async ({ project_id }, extra: { authInfo?: AuthInfo }) => {
        userId(extra);
        const admin = getSupabaseAdminClient();
        const { data, error } = await admin
          .from("assets")
          .select("id, kind, blob_url, filename, mime_type, analysis, created_at")
          .eq("project_id", project_id)
          .eq("kind", "upload")
          .is("deleted_at", null)
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        return { content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }] };
      },
    );

    server.registerTool(
      "list_job_events",
      {
        title: "List Job Events",
        description: "Tail recent events from a job's agent log (most recent first).",
        inputSchema: {
          job_id: z.string().uuid(),
          limit: z.number().int().min(1).max(200).default(50),
        },
      },
      async ({ job_id, limit }, extra: { authInfo?: AuthInfo }) => {
        userId(extra);
        const admin = getSupabaseAdminClient();
        const { data, error } = await admin
          .from("job_events")
          .select("id, ts, type, payload")
          .eq("job_id", job_id)
          .order("id", { ascending: false })
          .limit(limit);
        if (error) throw new Error(error.message);
        return { content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }] };
      },
    );
  },
  { capabilities: { tools: {} } },
  {
    basePath: "",
    verboseLogs: false,
    redisUrl: process.env.MCP_REDIS_URL,
  },
);

const handler = withMcpAuth(
  baseHandler,
  async (_req, bearerToken) => {
    if (!bearerToken) return undefined;
    // We accept the same Bearer format authenticateMcpRequest expects;
    // wrap in a Request so that helper can pull from headers.
    const req = new Request("http://internal/", {
      headers: { authorization: `Bearer ${bearerToken}` },
    });
    const ctx = await authenticateMcpRequest(req);
    if (!ctx) return undefined;
    return {
      token: bearerToken,
      clientId: ctx.tokenId,
      scopes: ctx.scopes,
      extra: { userId: ctx.userId },
    } satisfies AuthInfo & { extra: { userId: string } };
  },
  { required: true },
);

export { handler as GET, handler as POST };
