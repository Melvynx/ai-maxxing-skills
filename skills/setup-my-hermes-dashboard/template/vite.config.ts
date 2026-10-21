import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";

// Sonner injects its stylesheet with a runtime <style> element that carries no CSP nonce. The same CSS ships
// as sonner/dist/styles.css, imported from src/styles.css, so the runtime injection is removed at build time.
function sonnerWithoutInlineStyle(): Plugin {
  return {
    name: "sonner-without-inline-style",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]sonner[\\/]dist[\\/]index\.mjs$/.test(id)) return null;
      const stripped = code.replace(/^__insertCSS\(".*"\);?$/m, "");
      if (stripped === code) throw new Error("sonner: runtime CSS injection not found, review the CSP workaround");
      return { code: stripped, map: null };
    },
  };
}

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Hashed UI files live under /_ui/, out of the way of any page or API path.
  build: { assetsDir: "_ui" },
  server: { host: "127.0.0.1", port: 8794, strictPort: true },
  plugins: [sonnerWithoutInlineStyle(), tailwindcss(), tanstackStart(), nitro(), react()],
});
