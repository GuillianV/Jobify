import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base: "./" est important pour qu'Electron charge les assets en production
// via loadFile (chemins relatifs).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
  },
});
