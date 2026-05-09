"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GenerateReelForm({
  projectId,
  defaultLanguage,
}: {
  projectId: string;
  defaultLanguage: "de" | "en";
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [length, setLength] = useState<30 | 60>(30);
  const [language, setLanguage] = useState<"de" | "en">(defaultLanguage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/jobs/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, length_seconds: length, language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/jobs/${data.job_id}`);
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
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

      <div className="flex items-center gap-6">
        <fieldset className="flex items-center gap-3 text-sm">
          <legend className="sr-only">Länge</legend>
          <label className="flex items-center gap-1">
            <input type="radio" name="length" checked={length === 30} onChange={() => setLength(30)} /> 30s
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="length" checked={length === 60} onChange={() => setLength(60)} /> 60s
          </label>
        </fieldset>

        <fieldset className="flex items-center gap-3 text-sm">
          <legend className="sr-only">Sprache</legend>
          <label className="flex items-center gap-1">
            <input type="radio" name="lang" checked={language === "de"} onChange={() => setLanguage("de")} /> DE
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="lang" checked={language === "en"} onChange={() => setLanguage("en")} /> EN
          </label>
        </fieldset>
      </div>

      <button
        type="submit"
        disabled={loading || !url}
        className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        {loading ? "Starte…" : "Reel generieren"}
      </button>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}
    </form>
  );
}
