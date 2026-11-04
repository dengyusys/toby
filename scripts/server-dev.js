/**
 * Dev-mode server runner: Node 22's native type stripping runs src/main.ts
 * directly (the server source is erasable-syntax-only, enforced by tsc and
 * the editor, so dev needs no compile step), and --watch restarts it on any
 * change in the import graph. Loads the repository .env itself, inherits the
 * parent's environment, and forwards signals so Ctrl+C tears it down. Type
 * errors never gate a restart here — the editor and `pnpm run check` own
 * them, and production still builds through plain tsc (`pnpm run build`).
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverRoot = path.join(repositoryRoot, "apps/server");

const server = spawn(
  process.execPath,
  [
    `--env-file-if-exists=${path.join(repositoryRoot, ".env")}`,
    "--watch",
    "src/main.ts",
  ],
  {
    cwd: serverRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

// The runner ends with the server: dev.js then sees the server as down and
// tears the vite dev servers down with it.
server.on("exit", (code) => process.exit(code ?? 0));
