import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The build's short git SHA and time, shown in the footer; the SHA is also written into index.html so a running
// console can tell when a newer build has been published (it re-reads index.html every five minutes).
function gitSha(): string {
  const env = process.env.GITHUB_SHA;
  if (env) return env.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "dev";
  } catch {
    return "dev";
  }
}
const BUILD_SHA = gitSha();
const BUILD_TIME = new Date().toISOString();

function buildMeta(): Plugin {
  return {
    name: "nodus-build-meta",
    transformIndexHtml: (html) => html.replace("</head>", `  <meta name="nodus-build" content="${BUILD_SHA}" />\n  </head>`),
  };
}

// base './' so the built files work from any sub-path, e.g. https://<user>.github.io/nodus-console/
export default defineConfig({
  base: "./",
  plugins: [react(), buildMeta()],
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  // MapLibre's web worker is an ES module.
  worker: { format: "es" },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1400 },
});
