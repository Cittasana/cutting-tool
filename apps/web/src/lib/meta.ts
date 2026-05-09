/**
 * Meta Graph API helpers for Instagram Reels Auto-Posting.
 *
 * Flow:
 *   1. user clicks "Connect Instagram" → /api/auth/meta/start (per project)
 *   2. FB OAuth → /api/auth/meta/callback?code=...
 *   3. exchange code → short-lived token → long-lived (60d) → IG business account id
 *   4. store in Vault, write meta_token_expires_at
 *   5. publishReel(): POST /{ig_id}/media (container) → poll status → POST /{ig_id}/media_publish
 *   6. cron refreshLongLivedToken() before expiry
 */

const META_APP_ID = process.env.META_APP_ID!;
const META_APP_SECRET = process.env.META_APP_SECRET!;
const GRAPH_API = "https://graph.facebook.com/v21.0";

export const META_OAUTH_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
].join(",");

export function buildOAuthRedirect(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: redirectUri,
    state,
    scope: META_OAUTH_SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

interface ShortLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export async function exchangeCodeForShortLivedToken(
  code: string,
  redirectUri: string,
): Promise<ShortLivedTokenResponse> {
  const url = new URL(`${GRAPH_API}/oauth/access_token`);
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("client_secret", META_APP_SECRET);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`exchange code failed: ${await res.text()}`);
  return (await res.json()) as ShortLivedTokenResponse;
}

interface LongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds (~60 days)
}

export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<LongLivedTokenResponse> {
  const url = new URL(`${GRAPH_API}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("client_secret", META_APP_SECRET);
  url.searchParams.set("fb_exchange_token", shortLivedToken);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`long-lived exchange failed: ${await res.text()}`);
  return (await res.json()) as LongLivedTokenResponse;
}

interface IgAccountInfo {
  page_id: string;
  page_token: string;
  ig_business_account_id: string;
  ig_username: string;
}

export async function fetchInstagramBusinessAccount(
  longLivedToken: string,
): Promise<IgAccountInfo | null> {
  // 1. Get list of pages the user has access to
  const pagesRes = await fetch(
    `${GRAPH_API}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${longLivedToken}`,
  );
  if (!pagesRes.ok) {
    throw new Error(`fetch pages failed: ${await pagesRes.text()}`);
  }
  const pages = (await pagesRes.json()) as {
    data: Array<{
      id: string;
      access_token: string;
      instagram_business_account?: { id: string };
    }>;
  };

  // 2. Find first page with linked IG business account
  const linked = pages.data.find((p) => p.instagram_business_account?.id);
  if (!linked) return null;

  // 3. Get IG username for display
  const igRes = await fetch(
    `${GRAPH_API}/${linked.instagram_business_account!.id}?fields=username&access_token=${linked.access_token}`,
  );
  const ig = igRes.ok ? ((await igRes.json()) as { username?: string }) : { username: undefined };

  return {
    page_id: linked.id,
    page_token: linked.access_token,
    ig_business_account_id: linked.instagram_business_account!.id,
    ig_username: ig.username ?? "",
  };
}

export async function refreshLongLivedToken(token: string): Promise<LongLivedTokenResponse> {
  const url = new URL(`${GRAPH_API}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("client_secret", META_APP_SECRET);
  url.searchParams.set("fb_exchange_token", token);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`refresh failed: ${await res.text()}`);
  return (await res.json()) as LongLivedTokenResponse;
}

// ============================================================
// Reels Publishing
// ============================================================
export async function createReelContainer(opts: {
  igBusinessAccountId: string;
  pageToken: string;
  videoUrl: string;        // public Vercel Blob URL
  caption: string;
  shareToFeed?: boolean;
}): Promise<{ container_id: string }> {
  const url = `${GRAPH_API}/${opts.igBusinessAccountId}/media`;
  const params = new URLSearchParams({
    media_type: "REELS",
    video_url: opts.videoUrl,
    caption: opts.caption,
    access_token: opts.pageToken,
  });
  if (opts.shareToFeed) params.set("share_to_feed", "true");
  const res = await fetch(url, { method: "POST", body: params });
  if (!res.ok) throw new Error(`createReelContainer failed: ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  return { container_id: json.id };
}

export async function getContainerStatus(opts: {
  containerId: string;
  pageToken: string;
}): Promise<{ status_code: string }> {
  const res = await fetch(
    `${GRAPH_API}/${opts.containerId}?fields=status_code&access_token=${opts.pageToken}`,
  );
  if (!res.ok) throw new Error(`getContainerStatus failed: ${await res.text()}`);
  return (await res.json()) as { status_code: string };
}

export async function publishContainer(opts: {
  igBusinessAccountId: string;
  pageToken: string;
  containerId: string;
}): Promise<{ media_id: string }> {
  const url = `${GRAPH_API}/${opts.igBusinessAccountId}/media_publish`;
  const params = new URLSearchParams({
    creation_id: opts.containerId,
    access_token: opts.pageToken,
  });
  const res = await fetch(url, { method: "POST", body: params });
  if (!res.ok) throw new Error(`publishContainer failed: ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  return { media_id: json.id };
}
