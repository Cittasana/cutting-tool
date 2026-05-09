import * as cheerio from "cheerio";
import type { Language, ProductContext } from "./schemas.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36";

export async function scrape(url: string): Promise<ProductContext> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`scrape: ${url} returned ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    $("title").first().text().trim() ||
    new URL(url).hostname;

  const headline =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    $("h1").first().text().trim() ||
    undefined;

  const og_image_url =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    undefined;

  const copy_chunks: string[] = [];
  const seen = new Set<string>();
  for (const tag of ["h1", "h2", "h3", "p", "li"]) {
    $(tag).each((_, el) => {
      const txt = $(el).text().replace(/\s+/g, " ").trim();
      if (txt.length >= 20 && txt.length <= 400 && !seen.has(txt)) {
        seen.add(txt);
        copy_chunks.push(txt);
      }
    });
  }

  const detected_language = detectLanguage(`${title} ${headline ?? ""} ${copy_chunks.slice(0, 5).join(" ")}`);

  return {
    url,
    title: title.slice(0, 200),
    headline: headline?.slice(0, 300),
    copy_chunks: copy_chunks.slice(0, 80),
    og_image_url,
    detected_language,
  };
}

function detectLanguage(sample: string): Language | undefined {
  const lower = sample.toLowerCase();
  const deHits = (lower.match(/\b(und|der|die|das|nicht|sich|für|wir|sind|mit|ist|werden|kannst|deine?n?)\b/g) || []).length;
  const enHits = (lower.match(/\b(the|and|you|your|with|for|are|this|that|will|our|how)\b/g) || []).length;
  if (deHits + enHits < 3) return undefined;
  return deHits > enHits ? "de" : "en";
}
