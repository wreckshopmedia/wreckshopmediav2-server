import { Hono } from "hono";
import { cors } from "hono/cors";
import { timingSafeEqual } from "node:crypto";
import { sql } from "./db";
import { createRateLimiter } from "./rateLimit";
import { parseId, validateMessage, validatePlacement, validateVisit, PALETTE_SIZE } from "./validation";

export const app = new Hono();

// writes are public and unauthenticated, so they get a leash. reads stay unlimited.
const writeLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

/**
 * @description Best-effort client identity for rate limiting. Railway sits behind a
 * proxy so x-forwarded-for is what we get; it is spoofable, which is why the limiter
 * is a speed bump against drive-by spam rather than a security control.
 */
function clientKey(forwardedFor: string | undefined): string {
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

/**
 * @description Constant-time check of the admin bearer token. Returns false whenever
 * ADMIN_TOKEN is unset, so a misconfigured deploy fails closed instead of wide open.
 */
function isAdmin(authHeader: string | undefined): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !authHeader?.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(authHeader.slice("Bearer ".length));
  const target = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so the length check has to come first
  return supplied.length === target.length && timingSafeEqual(supplied, target);
}

/** @description Reads the JSON body, turning a malformed payload into null instead of a throw. */
async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

app.use(
  "/api/*",
  cors({
    origin: [
      "http://localhost:5371", // your local dev frontend
      "https://wreckshopmedia.com", // production
      "https://www.wreckshopmedia.com",
    ],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/", (c) => c.text("Ye ol' Wreck Shop Media API"));
app.get("/api/visits", (c) => c.text("Nooooo...Suparman no ess heeeeere..."));

/**
 * GET - /api/messages - fetch rant submissions
 * currently automatically grabs on /rants route
 */
app.get("/api/messages", async (c) => {
  // deleted IS NOT TRUE keeps soft-deleted notes off the board while still
  // matching legacy rows where deleted is NULL (pre-migration inserts)
  const rows =
    await sql`SELECT id, name, message, created_at, color, pos_x, pos_y, rotation FROM messages WHERE deleted IS NOT TRUE ORDER BY created_at DESC`;
  return c.json(rows);
});

/** POST - /api/messages - pin a new sticky note to the board. Public, so validated and throttled. */
app.post("/api/messages", async (c) => {
  if (!writeLimiter.allow(clientKey(c.req.header("x-forwarded-for")))) {
    return c.json({ error: "slow down, too many notes" }, 429);
  }

  const parsed = validateMessage(await readJson(c));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { name, message, color } = parsed.value;

  // the client owns the color cycle (a session cursor that only advances on
  // submit, never on delete), so honor the color it sends. fall back to one past
  // the newest note's color only if the client didn't supply one.
  let finalColor = color;
  if (finalColor === null) {
    const [last] = await sql`
      SELECT COALESCE(color, (id % ${PALETTE_SIZE})) AS c
      FROM messages ORDER BY id DESC LIMIT 1`;
    finalColor = last ? (Number(last.c) + 1) % PALETTE_SIZE : 0;
  }

  const [row] =
    await sql`INSERT INTO messages (name, message, color) VALUES (${name}, ${message}, ${finalColor}) RETURNING *`;
  return c.json(row, 201);
});

/**
 * PATCH - /api/messages/:id - persist where a note was dropped.
 * pos_x / pos_y are 0-1 fractions of the canvas; rotation is degrees.
 */
app.patch("/api/messages/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not found" }, 404);

  const parsed = validatePlacement(await readJson(c));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { pos_x, pos_y, rotation } = parsed.value;

  const [row] = await sql`
    UPDATE messages SET pos_x = ${pos_x}, pos_y = ${pos_y}, rotation = ${rotation}
    WHERE id = ${id} RETURNING *`;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

/** PATCH - /api/messages/:id/delete - soft delete, the only delete the public board uses. */
app.patch("/api/messages/:id/delete", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not found" }, 404);

  const [row] = await sql`
    UPDATE messages SET deleted = TRUE
    WHERE id = ${id} RETURNING *`;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

/**
 * PATCH - /api/messages/:id/undelete - put a note back on the board.
 * Admin only: send `Authorization: Bearer $ADMIN_TOKEN`.
 */
app.patch("/api/messages/:id/undelete", async (c) => {
  if (!isAdmin(c.req.header("authorization"))) return c.json({ error: "nope" }, 401);

  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not found" }, 404);

  const [row] = await sql`
    UPDATE messages SET deleted = FALSE
    WHERE id = ${id} RETURNING *`;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

/**
 * DELETE - /api/messages/:id - trash a note for good.
 * Admin only: send `Authorization: Bearer $ADMIN_TOKEN`. The public board soft deletes
 * instead, so nothing in the client hits this.
 */
app.delete("/api/messages/:id", async (c) => {
  if (!isAdmin(c.req.header("authorization"))) return c.json({ error: "nope" }, 401);

  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not found" }, 404);

  await sql`DELETE FROM messages WHERE id = ${id}`;
  return c.json({ ok: true });
});

/** POST - /api/visits - record a site visit. Expects session_id and path in the request body. */
app.post("/api/visits", async (c) => {
  if (!writeLimiter.allow(clientKey(c.req.header("x-forwarded-for")))) {
    return c.json({ error: "slow down" }, 429);
  }

  const parsed = validateVisit(await readJson(c));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { session_id, path } = parsed.value;

  await sql`INSERT INTO visits (session_id, path) VALUES (${session_id}, ${path})`;
  return c.json({ ok: true }, 201);
});
