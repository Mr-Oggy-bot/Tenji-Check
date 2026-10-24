import path from "node:path";
import { fileURLToPath } from "node:url";

const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config, { webpack }) {
    // CopilotKit's chat CSS is Tailwind v4 output that this app's Tailwind v3 PostCSS step cannot parse. Its own
    // import is swapped for an empty file; the original is served as-is from /vendor/copilotkit.css.
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(
      /@copilotkit[\\/]react-core[\\/]dist[\\/]v2[\\/]index\.css$/,
      path.join(here, "src", "lib", "assistant", "empty.css"),
    ));
    return config;
  },
  async rewrites() {
    // Same-origin proxy: the browser only talks to the Next.js server, which forwards /api to FastAPI.
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
