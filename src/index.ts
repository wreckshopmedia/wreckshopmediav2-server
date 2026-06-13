import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import postgres from "postgres";

// onnotice no-op silences the harmless "column already exists, skipping" NOTICEs
// the idempotent migration emits on every boot after the first
const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
const app = new Hono();

// how many colors the sticky-note palette cycles through (must match the client)
const PALETTE_SIZE = 5;

/**
 * Idempotent migration - runs on boot so Railway self-applies on deploy.
 * Adds the sticky-board columns: color (palette index locked at creation),
 * pos_x / pos_y (0-1 fractions of the canvas, responsive), rotation (degrees).
 */
async function migrate() {
  // create the base tables first so a fresh DB (e.g. a new Railway Postgres)
  // doesn't crash the ALTERs below by altering a table that doesn't exist yet.
  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      name TEXT,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS visits (
      id SERIAL PRIMARY KEY,
      session_id TEXT,
      path TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS color SMALLINT`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS pos_x REAL`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS pos_y REAL`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS rotation REAL`;
  console.log("migration ok - sticky columns present");
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
  const rows =
    await sql`SELECT id, name, message, created_at, color, pos_x, pos_y, rotation FROM messages ORDER BY created_at DESC`;
  return c.json(rows);
});

app.post("/api/messages", async (c) => {
  const { name, message, color } = await c.req.json();
  // the client owns the color cycle (a session cursor that only advances on
  // submit, never on delete), so honor the color it sends. fall back to one past
  // the newest note's color only if the client didn't supply one.
  let finalColor: number;
  if (typeof color === "number") {
    finalColor = ((color % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  } else {
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
  const id = Number(c.req.param("id"));
  const { pos_x, pos_y, rotation } = await c.req.json();
  const [row] = await sql`
    UPDATE messages SET pos_x = ${pos_x}, pos_y = ${pos_y}, rotation = ${rotation}
    WHERE id = ${id} RETURNING *`;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

/** DELETE - /api/messages/:id - trash a note for good. */
app.delete("/api/messages/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await sql`DELETE FROM messages WHERE id = ${id}`;
  return c.json({ ok: true });
});

app.post("/api/visits", async (c) => {
  const { session_id, path } = await c.req.json();
  await sql`INSERT INTO visits (session_id, path) VALUES (${session_id}, ${path})`;
  return c.json({ ok: true }, 201);
});

const port = Number(process.env.PORT) || 4321;

// run the migration before accepting traffic so the columns always exist
migrate()
  .then(() => {
    serve({ fetch: app.fetch, port });
    console.log(`Server running on http://localhost:${port}`);
  })
  .catch((err) => {
    console.error("migration failed - not starting server", err);
    process.exit(1);
  });
