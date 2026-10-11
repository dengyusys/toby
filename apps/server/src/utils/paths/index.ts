/**
 * Path location utilities: find files by walking upward from a starting
 * directory. A leaf module — may not import domains or infrastructure.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Walk upward from startDirectory until fileName appears; throw at the filesystem root. */
export function findUp(startDirectory: string, fileName: string): string {
  let directory = startDirectory;
  for (;;) {
    const candidate = path.join(directory, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(
        `${fileName} not found in any directory above ${startDirectory}`,
      );
    }
    directory = parent;
  }
}

/** Directory containing fileName (dirname of findUp). */
export function findUpDirectory(
  startDirectory: string,
  fileName: string,
): string {
  return path.dirname(findUp(startDirectory, fileName));
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

/**
 * Repository root: the directory holding pnpm-workspace.yaml — the only
 * place that marker exists. Robust to file relocation, no hand-counted
 * "../" hops.
 */
export const repositoryRoot = findUpDirectory(
  moduleDirectory,
  "pnpm-workspace.yaml",
);

/** Path of the nearest package.json above a directory (from this module: the server package's). */
export function findPackageJsonPath(startDirectory: string): string {
  return findUp(startDirectory, "package.json");
}
