/**
 * Import-boundary tests: the architecture rules from
 * docs/decisions/vertical-domains.md, encoded as plain TypeScript instead of
 * ESLint regexes. A violation fails `pnpm run test` / `pnpm run check`, so
 * boundaries stay machine-enforced rather than a review-memory requirement.
 *
 * Scope: the four source roots only. Test directories are not governed —
 * they legitimately reach into app sources to assert behavior.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const serverSrc = path.join(repositoryRoot, "apps/server/src");
const webSrc = path.join(repositoryRoot, "apps/web/src");
const mobileSrc = path.join(repositoryRoot, "apps/web-mobile/src");
const contractSrc = path.join(repositoryRoot, "packages/contract/src");
const sourceRoots = [serverSrc, webSrc, mobileSrc, contractSrc];

const domainsDir = path.join(serverSrc, "domains");
const infrastructureDir = path.join(serverSrc, "infrastructure");
const utilsDir = path.join(serverSrc, "utils");
const httpDir = path.join(infrastructureDir, "http");

// HTTP assembly internals: the Nest app factory and static assets. Domains
// build routes against the shared contract and response writer instead.
const ASSEMBLY_MODULES = ["nest-app", "static-assets"];

// Domains each domain may depend on. Domains are discovered from the
// filesystem, so a new domain is governed the moment it lands; only domains
// with sanctioned cross-domain dependencies need a row here (none today).
const DOMAIN_DEPENDENCIES: Record<string, readonly string[]> = {};

// --- collection -----------------------------------------------------------

interface ImportEdge {
  file: string;
  specifier: string;
  /** Absolute resolved path for relative specifiers; null for package ones. */
  resolved: string | null;
}

// `from "x"` (incl. `export ... from`), bare `import "x"`, `import("x")`.
// Static specifiers only; dynamically built imports are not analyzed.
const IMPORT_PATTERN = /(?:\bfrom\s+|\bimport\s*\(?\s*)(["'])([^"'\n]+)\1/g;

function collectFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  visit(root);
  return files;
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = /\.\w+$/.test(specifier)
    ? [base.replace(/\.(js|jsx|mjs|cjs)$/, ".ts"), base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
      ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? base;
}

const importEdges: ImportEdge[] = sourceRoots.flatMap((root) =>
  collectFiles(root).flatMap((file) => {
    const edges: ImportEdge[] = [];
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)) {
      const specifier = match[2];
      if (specifier !== undefined) {
        edges.push({
          file,
          specifier,
          resolved: resolveRelative(file, specifier),
        });
      }
    }
    return edges;
  }),
);

// --- predicates -----------------------------------------------------------

/** True when child lies inside parent (parent itself counts as inside). */
function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** First path segment of child relative to parent, or null when outside. */
function headSegment(child: string, parent: string): string | null {
  if (!inside(child, parent) || child === parent) return null;
  return path.relative(parent, child).split(path.sep)[0] ?? null;
}

function importsPackage(specifier: string, pkg: string): boolean {
  return specifier === pkg || specifier.startsWith(`${pkg}/`);
}

/** The domain name when the path sits in domains/<name>/, else null. */
function domainOf(file: string): string | null {
  return headSegment(file, domainsDir);
}

// --- rules ----------------------------------------------------------------

interface BoundaryRule {
  name: string;
  /** Human-readable violation detail, or null when the edge is allowed. */
  check: (edge: ImportEdge) => string | null;
}

const rules: BoundaryRule[] = [
  {
    name: "domains do not import other business domains outside DOMAIN_DEPENDENCIES",
    check: ({ file, resolved }) => {
      const domain = domainOf(file);
      const target = resolved === null ? null : domainOf(resolved);
      if (domain === null || target === null || target === domain) return null;
      const allowed = DOMAIN_DEPENDENCIES[domain] ?? [];
      if (allowed.includes(target)) return null;
      return allowed.length > 0
        ? `the ${domain} domain may only depend on: ${allowed.join(", ")}`
        : `the ${domain} domain must not depend on other business domains`;
    },
  },
  {
    name: "domain types.ts stays pure (no fastify, infrastructure or node: imports)",
    check: ({ file, specifier, resolved }) => {
      const domain = domainOf(file);
      if (domain === null) return null;
      if (path.relative(path.join(domainsDir, domain), file) !== "types.ts") {
        return null;
      }
      const forbidden =
        specifier.startsWith("node:") ||
        importsPackage(specifier, "fastify") ||
        specifier.startsWith("@fastify/") ||
        (resolved !== null && inside(resolved, infrastructureDir));
      return forbidden
        ? "domain types.ts must stay pure: no fastify, infrastructure or node: imports"
        : null;
    },
  },
  {
    name: "domains do not import HTTP assembly internals",
    check: ({ file, resolved }) => {
      const head = resolved === null ? null : headSegment(resolved, httpDir);
      const isAssembly =
        head !== null &&
        ASSEMBLY_MODULES.some((m) => head === m || head.startsWith(`${m}.`));
      return domainOf(file) !== null && isAssembly
        ? "assembly lives in main.ts and domain module.ts files"
        : null;
    },
  },
  {
    name: "infrastructure never imports business domains",
    check: ({ file, resolved }) =>
      inside(file, infrastructureDir) &&
      resolved !== null &&
      domainOf(resolved) !== null
        ? "assembly happens only in the composition root and domain module.ts files"
        : null,
  },
  {
    name: "utils stays a leaf (no domain or infrastructure imports)",
    check: ({ file, resolved }) =>
      inside(file, utilsDir) &&
      resolved !== null &&
      (domainOf(resolved) !== null || inside(resolved, infrastructureDir))
        ? "shared helpers never reach back into domains or infrastructure"
        : null,
  },
  {
    name: "web and web-mobile never import each other",
    check: ({ file, specifier, resolved }) => {
      if (
        inside(file, webSrc) &&
        (importsPackage(specifier, "@toby/web-mobile") ||
          (resolved !== null && inside(resolved, mobileSrc)))
      ) {
        return "share only through @toby/contract";
      }
      if (
        inside(file, mobileSrc) &&
        (importsPackage(specifier, "@toby/web") ||
          (resolved !== null && inside(resolved, webSrc)))
      ) {
        return "share only through @toby/contract";
      }
      return null;
    },
  },
  {
    name: "web apps and packages never import @toby/server",
    check: ({ file, specifier }) =>
      [webSrc, mobileSrc, contractSrc].some((root) => inside(file, root)) &&
      importsPackage(specifier, "@toby/server")
        ? "dependency direction is apps -> packages"
        : null,
  },
  {
    name: "@toby/contract is pure logic (no React imports)",
    check: ({ file, specifier }) =>
      inside(file, contractSrc) &&
      ["react", "react-dom"].some((pkg) => importsPackage(specifier, pkg))
        ? "contract is shared logic: no React and no UI-kit imports"
        : null,
  },
  {
    name: "relative imports stay inside their own source root",
    check: ({ file, resolved }) => {
      const root = sourceRoots.find((dir) => inside(file, dir));
      return root !== undefined && resolved !== null && !inside(resolved, root)
        ? "cross-root imports go through package names, never source paths"
        : null;
    },
  },
];

// --- tests ----------------------------------------------------------------

describe("import boundaries", () => {
  it("DOMAIN_DEPENDENCIES only names domains that exist", () => {
    const domainNames = readdirSync(domainsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const registered = [
      ...Object.keys(DOMAIN_DEPENDENCIES),
      ...Object.values(DOMAIN_DEPENDENCIES).flat(),
    ];
    expect(
      registered.filter((name) => !domainNames.includes(name)),
      "fix the DOMAIN_DEPENDENCIES table in test/boundaries.test.ts",
    ).toEqual([]);
  });

  for (const rule of rules) {
    it(rule.name, () => {
      const violations = importEdges.flatMap((edge) => {
        const detail = rule.check(edge);
        return detail === null
          ? []
          : [
              `${path.relative(repositoryRoot, edge.file)} imports "${edge.specifier}": ${detail}`,
            ];
      });
      expect(
        violations.join("\n"),
        `${violations.length} boundary violation(s)`,
      ).toBe("");
    });
  }
});
