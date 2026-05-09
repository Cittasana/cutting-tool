"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface InitialJob {
  id: string;
  status: string;
  progress: number;
  current_step: string | null;
  brief: unknown;
  storyboard: unknown;
  error: unknown;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface JobEvent {
  id: number | string;
  ts: string;
  type: string;
  payload: unknown;
}

export function JobLive({
  jobId,
  initialJob,
  initialEvents,
}: {
  jobId: string;
  initialJob: InitialJob;
  initialEvents: JobEvent[];
}) {
  const [status, setStatus] = useState(initialJob.status);
  const [progress, setProgress] = useState(initialJob.progress);
  const [step, setStep] = useState(initialJob.current_step);
  const [events, setEvents] = useState<JobEvent[]>(initialEvents);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`job:${jobId}`);

    channel.on("broadcast", { event: "progress" }, ({ payload }) => {
      const p = payload as { progress?: number; current_step?: string | null; status?: string };
      if (typeof p.progress === "number") setProgress(p.progress);
      if (p.current_step !== undefined) setStep(p.current_step);
      if (p.status) setStatus(p.status);
    });

    for (const evt of [
      "step.started",
      "step.finished",
      "scene.preview",
      "agent.thought",
      "error",
    ]) {
      channel.on("broadcast", { event: evt }, ({ payload }) => {
        setEvents((prev) => [
          ...prev,
          {
            id: `live-${Date.now()}-${Math.random()}`,
            ts: new Date().toISOString(),
            type: evt,
            payload,
          },
        ]);
      });
    }

    channel.subscribe();
    return () => {
      void channel.unsubscribe();
    };
  }, [jobId]);

  const isTerminal = status === "done" || status === "failed" || status === "cancelled";

  return (
    <>
      <section className="mb-8 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Status
          </span>
          <span
            className={
              status === "failed"
                ? "rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-800 dark:bg-red-950/30 dark:text-red-300"
                : status === "done"
                  ? "rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-950/30 dark:text-green-300"
                  : "rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
            }
          >
            {status}
          </span>
        </div>
        <div className="text-2xl font-semibold tabular-nums">{progress}%</div>
        {step && <p className="mt-1 font-mono text-xs text-zinc-500">{step}</p>}
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={
              status === "failed"
                ? "h-full bg-red-500 transition-all"
                : "h-full bg-zinc-900 transition-all dark:bg-zinc-100"
            }
            style={{ width: `${progress}%` }}
          />
        </div>
        {!isTerminal && (
          <p className="mt-3 text-xs text-zinc-500">Live · Updates über Supabase Broadcast</p>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Agent-Log
        </h2>
        <ul className="flex flex-col gap-2 font-mono text-xs">
          {events.map((e) => (
            <li
              key={e.id}
              className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{e.type}</span>
                <span className="text-zinc-500">{new Date(e.ts).toLocaleTimeString("de-DE")}</span>
              </div>
              <pre className="mt-1 whitespace-pre-wrap break-words text-zinc-600 dark:text-zinc-400">
                {JSON.stringify(e.payload, null, 2)}
              </pre>
            </li>
          ))}
          {events.length === 0 && <li className="text-zinc-500">Noch keine Events.</li>}
        </ul>
      </section>

      {!!initialJob.brief && (
        <section className="mb-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Brief
          </h3>
          <pre className="overflow-auto text-xs">{JSON.stringify(initialJob.brief, null, 2)}</pre>
        </section>
      )}

      {!!initialJob.storyboard && (
        <section className="mb-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Storyboard
          </h3>
          <pre className="overflow-auto text-xs">
            {JSON.stringify(initialJob.storyboard, null, 2)}
          </pre>
        </section>
      )}

      {!!initialJob.error && (
        <section className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          <strong>Fehler:</strong>
          <pre className="mt-2 overflow-auto text-xs">
            {JSON.stringify(initialJob.error, null, 2)}
          </pre>
        </section>
      )}
    </>
  );
}
