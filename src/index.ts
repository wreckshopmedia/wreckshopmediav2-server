import { serve } from "@hono/node-server";
import { app } from "./app";
import { sql } from "./db";

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
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE`;
  console.log("migration ok - sticky columns present");
}

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
