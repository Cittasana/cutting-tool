import { Sandbox } from "@vercel/sandbox";
import fs from "node:fs/promises";
import path from "node:path";

const SCRIPT_PATH = path.join(process.cwd(), "sandbox-scripts/analyze-asset.py");

/**
 * Spawn a one-shot sandbox to analyze a single uploaded asset.
 * Returns the parsed JSON manifest. Tear-down happens automatically.
 *
 * Cold-start: dnf python3 + scenedetect ≈ 60–120s. Future: cache via Sandbox.snapshot().
 */
export async function analyzeAssetInSandbox(opts: {
  assetUrl: string;
  filename: string;
}): Promise<unknown> {
  const sandbox = await Sandbox.create({
    runtime: "node24",                      // base image; we'll dnf-install python
    resources: { vcpus: 2 },
    timeout: 10 * 60 * 1000,
  });

  try {
    // 1. System deps
    const sys = await sandbox.runCommand({
      cmd: "sudo",
      args: ["dnf", "install", "-y", "python3", "python3-pip", "ffmpeg-free", "git"],
      sudo: true,
    });
    if (sys.exitCode !== 0) {
      throw new Error(`dnf install: ${(await sys.stderr()).slice(0, 600)}`);
    }

    // 2. PySceneDetect (pulls opencv-python-headless + numpy)
    const pip = await sandbox.runCommand("pip3", [
      "install",
      "--quiet",
      "scenedetect[opencv-headless]>=0.7",
    ]);
    if (pip.exitCode !== 0) {
      throw new Error(`pip install: ${(await pip.stderr()).slice(0, 600)}`);
    }

    // 3. Stage the analyzer script.
    const scriptText = await fs.readFile(SCRIPT_PATH, "utf8");
    await sandbox.writeFiles([{ path: "analyze.py", content: Buffer.from(scriptText) }]);

    // 4. Download asset.
    const dl = await sandbox.runCommand("curl", ["-fsSL", "-o", "input.bin", opts.assetUrl]);
    if (dl.exitCode !== 0) {
      throw new Error(`download asset: ${(await dl.stderr()).slice(0, 400)}`);
    }

    // 5. Run analyzer.
    const run = await sandbox.runCommand("python3", ["analyze.py", "input.bin", "out.json"]);
    if (run.exitCode !== 0) {
      throw new Error(`analyze.py exit ${run.exitCode}: ${(await run.stderr()).slice(0, 600)}`);
    }

    // 6. Read JSON output.
    const buf = await sandbox.readFileToBuffer({ path: "out.json" });
    if (!buf) throw new Error("analyze.py produced no out.json");
    return JSON.parse(Buffer.from(buf).toString("utf8"));
  } finally {
    await sandbox.stop();
  }
}
