import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Browser host. The shared UI's lazy elkjs chunk is fine here — a real page has no webview CSP, so
// keep vite's default code-splitting and just lift the size warning above the ~1.4 MB elk chunk.
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1600 },
});
