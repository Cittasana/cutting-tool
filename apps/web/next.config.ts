import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cutting-tool/core"],
  serverExternalPackages: ["@resvg/resvg-js", "@vercel/sandbox"],
};

export default withWorkflow(nextConfig);
