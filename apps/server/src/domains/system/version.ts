/**
 * Server version: read once from the server package.json. Kept out of the
 * controller so it stays a pure HTTP shell — the house layout for every
 * domain (controller / service / pure files).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findPackageJsonPath } from "../../utils/paths/index.ts";

// The server package.json sits above this domain; findUp locates it without
// hand-counted "../" hops.
const packageJsonPath = findPackageJsonPath(
  path.dirname(fileURLToPath(import.meta.url)),
);

/** The server's own version ("0.0.0" if the field is missing). */
export function readServerVersion(): string {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: string;
  };
  return pkg.version ?? "0.0.0";
}
