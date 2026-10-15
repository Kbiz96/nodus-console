import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base './' so the built files work from any sub-path, e.g. https://<user>.github.io/nodus-console/
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 800 },
});
