import { Sandbox } from "@vercel/sandbox";

export interface RenderSandboxOpts {
  timeoutMinutes?: number;
  vcpus?: 2 | 4 | 8;
}

/**
 * Create a Vercel Sandbox provisioned for reel rendering:
 *  - Amazon Linux 2023 + Node 24
 *  - ffmpeg-free (system dnf package)
 *  - @higgsfield/cli installed globally (auto-downloads `hf` Go binary)
 *
 * One sandbox per workflow run. Tear down via the returned `stop()`.
 */
export async function createRenderSandbox(opts: RenderSandboxOpts = {}) {
  const sandbox = await Sandbox.create({
    runtime: "node24",
    resources: { vcpus: opts.vcpus ?? 4 },
    timeout: (opts.timeoutMinutes ?? 30) * 60 * 1000,
  });

  // Install ffmpeg + node-build deps. dnf on AL2023 has ffmpeg-free.
  const installFfmpeg = await sandbox.runCommand({
    cmd: "sudo",
    args: ["dnf", "install", "-y", "ffmpeg-free", "tar", "xz", "curl"],
    sudo: true,
  });
  if (installFfmpeg.exitCode !== 0) {
    const stderr = await installFfmpeg.stderr();
    throw new Error(`dnf install ffmpeg-free failed: ${stderr.slice(0, 1000)}`);
  }

  // Higgsfield CLI is a thin npm wrapper around a Go binary; postinstall pulls
  // the platform-appropriate `hf` from GitHub releases. Global install puts it
  // on PATH so subsequent `hf` calls work.
  const installHf = await sandbox.runCommand("npm", ["install", "-g", "@higgsfield/cli"]);
  if (installHf.exitCode !== 0) {
    const stderr = await installHf.stderr();
    throw new Error(`npm install @higgsfield/cli failed: ${stderr.slice(0, 1000)}`);
  }

  return {
    sandbox,
    async stop() {
      await sandbox.stop();
    },
  };
}

export type RenderSandbox = Awaited<ReturnType<typeof createRenderSandbox>>;
