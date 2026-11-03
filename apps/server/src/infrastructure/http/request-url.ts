/**
 * The one pre-routing URL rewrite, keeping what the first server's two
 * static layers each did on their own:
 * - `/api/*` paths lose one trailing slash (`/api/x/` matches `/api/x`);
 *   everything else about them — dot segments included — stays as sent, so
 *   path noise keeps missing the route.
 * - Every other path is collapsed the way the site-root file handler
 *   collapsed it (`/assets/../index.html` serves `/index.html`), never
 *   crossing the site root and never collapsing INTO an `/api/` route.
 *   A nested mount (`/m`) adds one rule on top: when the request's own
 *   dot segments climb OUT of the mount (`/m/../m/index.html`), its
 *   handler refuses the original path — and the site-root layer would
 *   only serve the collapsed form outside the mount. So inside the mount
 *   the original stays (a not-found), while across it
 *   (`/m/../index.html`) the collapsed root path is served.
 */

export function normalizeRequestUrl(
  url: string,
  /** Nested mounts, by their single leading segment (e.g. `["m"]`). */
  mounts: readonly string[] = [],
): string {
  const queryStart = url.indexOf("?");
  const path = queryStart === -1 ? url : url.slice(0, queryStart);
  const query = queryStart === -1 ? "" : url.slice(queryStart);
  const rewritten = path.startsWith("/api/")
    ? stripOneTrailingSlash(path)
    : collapseForStatic(path, mounts);
  return rewritten === path ? url : rewritten + query;
}

function stripOneTrailingSlash(path: string): string {
  if (path.length <= "/api/".length || !path.endsWith("/")) {
    return path;
  }
  return path.slice(0, -1);
}

function collapseForStatic(path: string, mounts: readonly string[]): string {
  const collapsed = collapseInRoot(path);
  // Escaping the site root, or landing on an /api route: not this
  // layer's business — the path stays as sent.
  if (
    collapsed === null ||
    collapsed === "/api" ||
    collapsed.startsWith("/api/")
  ) {
    return path;
  }
  for (const mount of mounts) {
    const prefix = `/${mount}`;
    if (path !== prefix && !path.startsWith(`${prefix}/`)) {
      continue;
    }
    const local = collapseInRoot(path.slice(prefix.length));
    if (local === null || local.startsWith("/../")) {
      // The request's own dots climb out of the mount: its handler
      // refuses the original. The site-root layer in front of it serves
      // the collapsed path only OUTSIDE the mount — inside it, nothing
      // does, and the original stays a not-found.
      const insideMount =
        collapsed === prefix || collapsed.startsWith(`${prefix}/`);
      return insideMount ? path : collapsed;
    }
  }
  return collapsed;
}

/**
 * Collapses `.`, `..` and `//` segments; `null` when a `..` would climb
 * above the root. A trailing `.`/`..` keeps its slash.
 */
function collapseInRoot(path: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null; // undecodable: leave it for the router's 400
  }
  if (!decoded.includes("/.") && !decoded.includes("//")) {
    return decoded;
  }
  const segments = decoded.split("/");
  const out: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const last = index === segments.length - 1;
    // An interior empty segment is a doubled separator; the leading and
    // trailing ones are the path's slashes and stay.
    if (segment === "" && index > 0 && !last) {
      continue;
    }
    if (segment === ".") {
      if (last) {
        out.push("");
      }
      continue;
    }
    if (segment === "..") {
      if (out.length <= 1) {
        return null;
      }
      out.pop();
      if (last) {
        out.push("");
      }
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}
