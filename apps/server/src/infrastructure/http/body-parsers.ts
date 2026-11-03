/**
 * Request body parsers, matching what the API has always accepted:
 * - JSON: Fastify's own parser (prototype-poisoning rejects, BOM handling,
 *   its 400 for undecodable JSON), except that a zero-length payload parses
 *   as `{}`, as the old body parser did.
 * - URL-encoded forms: flat key/value pairs; a repeated key becomes an
 *   array.
 * - Any other content type: read within the body limit and dropped, so the
 *   route's own validation answers (a 400), not a 415.
 * A request without any body is never parsed: `request.body` stays
 * `undefined`, and a route that needs one rejects it.
 */

import type { FastifyInstance } from "fastify";

function asText(body: string | Buffer): string {
  return typeof body === "string" ? body : body.toString("utf8");
}

/** Prototype-safe: `Object.fromEntries` defines keys, never sets them. */
function parseForm(text: string): Record<string, string | string[]> {
  const fields = new Map<string, string | string[]>();
  for (const [key, value] of new URLSearchParams(text)) {
    const seen = fields.get(key);
    fields.set(key, seen === undefined ? value : [seen, value].flat());
  }
  return Object.fromEntries(fields);
}

export function registerBodyParsers(app: FastifyInstance): void {
  const parseJson = app.getDefaultJsonParser("error", "error");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      const text = asText(body);
      if (text === "") {
        // A declared zero-length body (Content-Length: 0, or chunked with
        // no chunks) parses as {}, like the old body parser; a request
        // that declares no body at all leaves it undefined, so a route
        // expecting one rejects it.
        const declared =
          request.headers["content-length"] !== undefined ||
          request.headers["transfer-encoding"] !== undefined;
        done(null, declared ? {} : undefined);
        return;
      }
      parseJson(request, text, done);
    },
  );
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, parseForm(asText(body)));
    },
  );
  app.addContentTypeParser(
    "*",
    { parseAs: "buffer" },
    (_request, _body, done) => {
      done(null, undefined);
    },
  );
}
