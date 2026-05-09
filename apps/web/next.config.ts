import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cutting-tool/core"],
};

export default withWorkflow(nextConfig);
