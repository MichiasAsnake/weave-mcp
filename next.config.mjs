/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/v2/agent": ["./data/registry/**/*"],
  },
};

export default nextConfig;
