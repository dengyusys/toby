/**
 * Dev orchestrator: start the server (8629) first, wait until it is healthy,
 * then start both Vite dev servers (web 8630, web-mobile 8631). Prefixes every
 * output line with its process name so three interleaved logs stay readable,
 * and tears everything down on Ctrl+C or an unexpected child exit.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

/** Walk upward until fileName appears; null at the filesystem root. */
function findUpDirectory(startDirectory, fileName) {
  let directory = startDirectory;
  for (;;) {
    if (existsSync(path.join(directory, fileName))) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

// Repository root = the directory holding pnpm-workspace.yaml. Never trust
// cwd: `pnpm run dev` could be invoked from anywhere.
const repositoryRoot = findUpDirectory(
  path.dirname(fileURLToPath(import.meta.url)),
  "pnpm-workspace.yaml",
);
if (!repositoryRoot) {
  console.error("[dev] pnpm-workspace.yaml not found above scripts/");
  process.exit(1);
}

// The health URL must match what the server actually binds. The server reads
// .env via --env-file-if-exists; this script only sees exported environment
// variables — if you change TOBY_PORT inside .env, export it too (documented
// in docs/operations/local-dev.md).
const serverPort = process.env.TOBY_PORT ?? "8629";
const healthUrl = `http://127.0.0.1:${serverPort}/api/system/health`;

// Spawn node.exe directly with each tool's JS entry. On Windows spawn only
// resolves real executables, not the .cmd shims pnpm generates for `vite`;
// `shell: true` would interpose a cmd.exe wrapper that swallows kill signals
// and leaves orphaned dev servers holding their ports.
const viteWebBin = path.join(
  repositoryRoot,
  "apps/web/node_modules/vite/bin/vite.js",
);
const viteMobileBin = path.join(
  repositoryRoot,
  "apps/web-mobile/node_modules/vite/bin/vite.js",
);

for (const [name, bin] of [
  ["apps/web", viteWebBin],
  ["apps/web-mobile", viteMobileBin],
]) {
  if (!existsSync(bin)) {
    console.error(`[dev] ${bin} not found (${name}) — run pnpm install first`);
    process.exit(1);
  }
}

const children = [];
let shuttingDown = false;
let pendingExitCode = 0;

/** Idempotent teardown: kill every child, then exit; 3s deadline as a guard. */
function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  pendingExitCode = exitCode;
  for (const entry of children) {
    if (!entry.exited) {
      entry.child.kill();
    }
  }
  setTimeout(() => process.exit(exitCode), 3000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/** Print each stdout/stderr line with a [name] prefix, in order, per line. */
function pipeWithPrefix(name, stream) {
  if (!stream) {
    return;
  }
  readline.createInterface({ input: stream }).on("line", (line) => {
    process.stdout.write(`[${name}] ${line}\n`);
  });
}

/**
 * Register a child: label its output and react to its exit. Outside shutdown,
 * any exit is a failure (dead server = useless vite) and tears the rest down;
 * during shutdown, exit 0 as soon as every child is gone.
 */
function registerChild(name, child) {
  const entry = { child, exited: false };
  children.push(entry);
  pipeWithPrefix(name, child.stdout);
  pipeWithPrefix(name, child.stderr);
  child.on("exit", (code) => {
    entry.exited = true;
    if (!shuttingDown) {
      console.error(`[${name}] exited unexpectedly (code ${code})`);
      shutdown(1);
    } else if (children.every((candidate) => candidate.exited)) {
      process.exit(pendingExitCode);
    }
  });
  return entry;
}

function spawnNode(args, cwd) {
  return spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

/** Poll the health endpoint until it answers ok; fail fast on child exit. */
async function waitForServer(entry, url, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    if (entry.exited) {
      throw new Error("server exited before becoming healthy");
    }
    if (Date.now() > deadline) {
      throw new Error(`server not healthy within ${deadlineMs}ms at ${url}`);
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Not up yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function main() {
  const server = spawnNode(
    [
      `--env-file-if-exists=${path.join(repositoryRoot, ".env")}`,
      path.join(repositoryRoot, "scripts/nest-dev.js"),
    ],
    repositoryRoot,
  );
  const serverEntry = registerChild("server", server);

  try {
    await waitForServer(serverEntry, healthUrl, 20000);
  } catch (error) {
    console.error(`[dev] ${error.message}`);
    shutdown(1);
    return;
  }

  // Both dev servers proxy /api to the server, so they must start after it.
  registerChild(
    "web",
    spawnNode([viteWebBin], path.join(repositoryRoot, "apps/web")),
  );
  registerChild(
    "web-mobile",
    spawnNode([viteMobileBin], path.join(repositoryRoot, "apps/web-mobile")),
  );

  console.error(
    `[dev] up: server ${healthUrl} | web http://localhost:8630/ | web-mobile http://localhost:8631/m/`,
  );
}

await main();
