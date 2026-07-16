import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// In dev, proxy API calls to the FastAPI backend so the browser sees a single origin.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The MAS compliance engine and rule config live at the repo root (lib/, config/),
      // per the deliverable paths. Alias keeps imports clean from within frontend/src.
      "@compliance": fileURLToPath(new URL("../lib/compliance", import.meta.url)),
      "@rules": fileURLToPath(new URL("../config/rules", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Allow serving files from the repo root (lib/, config/) — one level above frontend.
    fs: { allow: [".."] },
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
