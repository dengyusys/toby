/**
 * Dev-mode server runner: `tsc --watch` compiles, `node --watch dist/main.js`
 * runs; the server starts only after the first clean compile, so it is never
 * launched against a half-written or missing dist/ — and never started twice
 * (the watcher's initial pass does not restart it, only later source edits
 * do). Inherits the parent's environment (already loaded from .env by the
 * --env-file-if-exists flag in dev.js) and forwards signals so Ctrl+C tears
 * both down.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "../apps/server");
const tsc = path.join(serverRoot, "node_modules/typescript/bin/tsc");

const children = [
  spawn(
    process.execPath,
    [tsc, "-p", "tsconfig.build.json", "--watch", "--preserveWatchOutput"],
    {
      cwd: serverRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  ),
];
const [compiler] = children;
compiler.stderr.pipe(process.stderr);

// The first compile status decides when the server may start: with errors
// it stays down (fix the code and the next clean compile starts it).
const firstCompile = new Promise((resolve) => {
  let settled = false;
  const settle = () => {
    if (!settled) {
      settled = true;
      resolve();
    }
  };
  let buffer = "";
  compiler.stdout.setEncoding("utf8");
  compiler.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    buffer += chunk;
    if (/Found 0 errors?/.test(buffer)) {
      settle();
    }
  });
  // A first status with errors keeps the server down, but the runner must
  // not hang forever if the watcher dies before printing anything.
  compiler.on("exit", settle);
});

await firstCompile;

if (compiler.exitCode === null) {
  children.push(
    spawn(process.execPath, ["--watch", "dist/main.js"], {
      cwd: serverRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    }),
  );
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children) {
      child.kill(signal);
    }
  });
}

// Either child ending ends the runner: dev.js then sees the server as down.
let exiting = false;
for (const child of children) {
  child.on("exit", (code) => {
    if (exiting) {
      return;
    }
    exiting = true;
    for (const other of children) {
      if (other !== child) {
        other.kill();
      }
    }
    process.exit(code ?? 0);
  });
}
