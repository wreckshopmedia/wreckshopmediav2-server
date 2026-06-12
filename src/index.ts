import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);
const app = new Hono();

app.use(
  "/api/*",
  cors({
    origin: [
      "http://localhost:5371", // your local dev frontend
      "https://wreckshopmedia.com", // production
      "https://www.wreckshopmedia.com",
    ],
  }),
);

app.get("/", (c) => c.text("Ye ol' Wreck Shop Media API"));
app.get("/api/visits", (c) => c.text("Nooooo...Suparman no ess heeeeere..."));

app.get("/api/messages", async (c) => {
  const rows =
    await sql`SELECT id, name, message, created_at FROM messages ORDER BY created_at DESC`;
  return c.json(rows);
});

app.post("/api/messages", async (c) => {
  const { name, message } = await c.req.json();
  const [row] =
    await sql`INSERT INTO messages (name, message) VALUES (${name}, ${message}) RETURNING *`;
  return c.json(row, 201);
});

app.post("/api/visits", async (c) => {
  const { session_id, path } = await c.req.json();
  await sql`INSERT INTO visits (session_id, path) VALUES (${session_id}, ${path})`;
  return c.json({ ok: true }, 201);
});

const port = Number(process.env.PORT) || 4321;
serve({ fetch: app.fetch, port });
console.log(`Server running on http://localhost:${port}`);
