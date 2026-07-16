import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// In dev, proxy API calls to the FastAPI backend so the browser sees a single origin.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The MAS compliance engine lives under src/compliance so the whole app is
      // self-contained in the Docker build context (frontend/ is copied wholesale).
      "@compliance": fileURLToPath(new URL("./src/compliance", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
