import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@canalis/core", "@canalis/providers"],
};

export default nextConfig;
