import fs from "node:fs";
import path from "node:path";

type Level = "info" | "warn" | "error" | "debug";

export class RunLogger {
  private file: string;

  constructor(runDir: string) {
    fs.mkdirSync(runDir, { recursive: true });
    this.file = path.join(runDir, "run.log.jsonl");
  }

  private write(level: Level, msg: string, meta?: unknown) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...(meta && typeof meta === "object" ? meta : meta ? { meta } : {}),
    };
    fs.appendFileSync(this.file, JSON.stringify(entry) + "\n");
    const tag = level === "error" ? "✗" : level === "warn" ? "!" : "·";
    console.log(`${tag} ${msg}`);
  }

  info(msg: string, meta?: unknown) {
    this.write("info", msg, meta);
  }
  warn(msg: string, meta?: unknown) {
    this.write("warn", msg, meta);
  }
  error(msg: string, meta?: unknown) {
    this.write("error", msg, meta);
  }
  debug(msg: string, meta?: unknown) {
    this.write("debug", msg, meta);
  }
}
