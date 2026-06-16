/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["jszip", "csv-parse"]
  }
};

export default nextConfig;
