"use client";

import { useState } from "react";

interface TestResult {
  brief: {
    language: string;
    target_audience: string;
    hook: string;
    value_props: string[];
    cta: string;
    tone: string[];
    visual_style: string;
  };
  storyboard: {
    total_duration_seconds: number;
    scenes: Array<{
      index: number;
      kind: string;
      model: string;
      duration: number;
      voiceover_text: string;
    }>;
  };
  scraped: { title: string; chunks: number };
}

export function TestBriefForm({ projectId }: { projectId: string }) {
  const [url, setUrl] = useState("");
  const [length, setLength] = useState<30 | 60>(30);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/test-brief`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, length_seconds: length }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Produkt-URL
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://webinar.cittasana.de"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="length"
              checked={length === 30}
              onChange={() => setLength(30)}
            />
            30s
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="length"
              checked={length === 60}
              onChange={() => setLength(60)}
            />
            60s
          </label>
        </div>
        <button
          type="submit"
          disabled={loading || !url}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {loading ? "Generiere…" : "Brief + Storyboard generieren"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 flex flex-col gap-4">
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Brief
            </h3>
            <div className="grid gap-1 text-sm">
              <div><strong>Hook:</strong> {result.brief.hook}</div>
              <div><strong>Audience:</strong> {result.brief.target_audience}</div>
              <div><strong>CTA:</strong> {result.brief.cta}</div>
              <div><strong>Tone:</strong> {result.brief.tone.join(", ")}</div>
              <div><strong>Value props:</strong></div>
              <ul className="ml-6 list-disc">
                {result.brief.value_props.map((v, i) => <li key={i}>{v}</li>)}
              </ul>
              <div className="mt-1"><strong>Visual style:</strong> {result.brief.visual_style}</div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Storyboard ({result.storyboard.total_duration_seconds}s · {result.storyboard.scenes.length} Szenen)
            </h3>
            <ul className="grid gap-1 text-xs">
              {result.storyboard.scenes.map((s) => (
                <li key={s.index} className="font-mono">
                  {s.index}. [{s.model}] {s.duration}s {s.kind}
                  {s.voiceover_text && <> — VO: {s.voiceover_text}</>}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-zinc-500">
            Quelle: <span className="font-mono">{result.scraped.title}</span> · {result.scraped.chunks} chunks
          </p>
        </div>
      )}
    </div>
  );
}
