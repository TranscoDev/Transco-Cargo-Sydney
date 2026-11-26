// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { writeFileSync } from "node:fs";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Each build gets its own id: baked into the app (__BUILD_ID__) and written to
// public/version.json. An open console compares the two and refreshes itself
// after a deploy (src/components/transco/update-check.tsx).
const BUILD_ID = Date.now().toString(36);
if (process.argv.includes("build")) {
  writeFileSync(new URL("./public/version.json", import.meta.url), JSON.stringify({ id: BUILD_ID }) + "\n");
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  },
});
