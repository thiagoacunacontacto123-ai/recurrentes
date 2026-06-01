import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config — build a SPA en /dist, y mantenemos /api/* fuera del build
// porque son serverless functions de Vercel (node runtime).
//
// `server.port` respeta la env var PORT que vercel dev inyecta cuando corre
// Vite como subproceso (sino caía a 5173 default y los assets quedaban
// orfan, dando pantalla blanca en localhost:3000).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    port: parseInt(process.env.PORT) || 5173,
    strictPort: false,
    host: true,
  },
});
