/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Allow larger request bodies for .md uploads and generated audio handling.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
