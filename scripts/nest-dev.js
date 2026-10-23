/**
 * Dev-mode Nest runner: spawns `nest start --watch` for the server with the
 * parent's environment (already loaded from .env by the --env-file flag in
 * dev.js), forwarding signals so Ctrl+C tears the watch loop down too.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "../apps/server");
const nestCli = path.join(serverRoot, "node_modules/@nestjs/cli/bin/nest.js");

const child = spawn(process.execPath, [nestCli, "start", "--watch"], {
  cwd: serverRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
