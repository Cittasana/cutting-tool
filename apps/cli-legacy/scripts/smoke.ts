import { spawn } from "node:child_process";

const args = [
  "src/cli.ts",
  "--url",
  "https://webinar.cittasana.de",
  "--length",
  "30",
  "--slug",
  "smoke-cittasana-webinar",
  "--language",
  "de",
  "--auto-accept-storyboard",
];

const child = spawn("tsx", args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
