/** @type {import('next').NextConfig} */
const nextConfig = {
  // Free Edge voices talk over a WebSocket (msedge-tts -> ws). Load it from
  // node_modules at runtime rather than bundling, so ws's optional native
  // add-ons don't break the build.
  serverExternalPackages: ["msedge-tts"],
  experimental: {
    // Allow larger request bodies for .md uploads and generated audio handling.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
