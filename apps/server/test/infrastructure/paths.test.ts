/**
 * Path utilities: the marker walk finds the repository root and the server
 * package.json from arbitrary starting directories.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findPackageJsonPath,
  findUp,
  repositoryRoot,
} from "../../src/utils/paths/index.ts";

// This test lives at apps/server/test/infrastructure/ — four levels below
// the repository root.
const testDirectory = path.dirname(fileURLToPath(import.meta.url));

describe("utils/paths", () => {
  it("findUp walks upward to the workspace marker", () => {
    const marker = findUp(testDirectory, "pnpm-workspace.yaml");
    expect(path.dirname(marker)).toBe(repositoryRoot);
  });

  it("repositoryRoot is the directory holding pnpm-workspace.yaml", () => {
    expect(repositoryRoot).toBe(path.resolve(testDirectory, "../../../.."));
  });

  it("findPackageJsonPath locates the nearest package.json", () => {
    const packageJson = findPackageJsonPath(testDirectory);
    expect(path.basename(packageJson)).toBe("package.json");
    // From the test directory the nearest one is the server package's.
    expect(path.dirname(packageJson)).toBe(
      path.resolve(testDirectory, "../.."),
    );
  });
});
