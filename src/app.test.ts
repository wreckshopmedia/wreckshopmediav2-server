import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./app";

// the sql tag is the only thing standing between these tests and a real database, so
// it gets stubbed. vitest hoists both of these above the app import, so the route
// handlers pick up the mock rather than a live postgres client.
const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock("./db", () => ({ sql: sqlMock }));

/** @description The interpolated values of a `sql` call, minus the template strings. */
function valuesOf(callIndex: number): unknown[] {
  return sqlMock.mock.calls[callIndex]!.slice(1);
}

/** @description Fires a JSON request at the app in memory - no port, no listener. */
function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  sqlMock.mockReset();
  sqlMock.mockResolvedValue([]);
  delete process.env.ADMIN_TOKEN;
});

describe("GET /api/messages", () => {
  it("returns the rows the query hands back", async () => {
    const rows = [{ id: 2, name: "Mo", message: "boats" }];
    sqlMock.mockResolvedValue(rows);

    const res = await request("GET", "/api/messages");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(rows);
  });
});

describe("POST /api/messages", () => {
  it("stores a valid note and echoes the created row", async () => {
    sqlMock.mockResolvedValue([{ id: 7, name: "Mo", message: "boats", color: 3 }]);

    const res = await request("POST", "/api/messages", {
      name: "  Mo  ",
      message: "  boats  ",
      color: 3,
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ id: 7 });
    // one call only: a client-supplied color skips the "what was the last color" lookup
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(valuesOf(0)).toEqual(["Mo", "boats", 3]);
  });

  it("derives the next palette color when the client does not send one", async () => {
    sqlMock
      .mockResolvedValueOnce([{ c: 2 }]) // newest note's color
      .mockResolvedValueOnce([{ id: 8 }]); // the insert

    const res = await request("POST", "/api/messages", { message: "boats" });

    expect(res.status).toBe(201);
    expect(valuesOf(1)).toEqual(["Anonymous", "boats", 3]);
  });

  it("starts the cycle at 0 on an empty board", async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 1 }]);

    await request("POST", "/api/messages", { message: "first" });

    expect(valuesOf(1)).toEqual(["Anonymous", "first", 0]);
  });

  it("rejects an empty message without touching the database", async () => {
    const res = await request("POST", "/api/messages", { message: "   " });

    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized message", async () => {
    const res = await request("POST", "/api/messages", { message: "x".repeat(201) });

    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("answers 400 rather than 500 on a malformed body", async () => {
    const res = await app.request("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });

    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/messages/:id", () => {
  it("saves a placement", async () => {
    sqlMock.mockResolvedValue([{ id: 3, pos_x: 0.5 }]);

    const res = await request("PATCH", "/api/messages/3", {
      pos_x: 0.5,
      pos_y: 0.25,
      rotation: -8,
    });

    expect(res.status).toBe(200);
    expect(valuesOf(0)).toEqual([0.5, 0.25, -8, 3]);
  });

  it("404s a placement for a row that isn't there", async () => {
    const res = await request("PATCH", "/api/messages/999", {
      pos_x: 0.5,
      pos_y: 0.5,
      rotation: 0,
    });

    expect(res.status).toBe(404);
  });

  it("rejects out-of-range coordinates", async () => {
    const res = await request("PATCH", "/api/messages/3", {
      pos_x: 42,
      pos_y: 0.5,
      rotation: 0,
    });

    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("404s a junk id before it ever reaches a query", async () => {
    const res = await request("PATCH", "/api/messages/abc", {
      pos_x: 0.5,
      pos_y: 0.5,
      rotation: 0,
    });

    expect(res.status).toBe(404);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/messages/:id/delete", () => {
  it("soft deletes without any auth, since the public board uses it", async () => {
    sqlMock.mockResolvedValue([{ id: 5, deleted: true }]);

    const res = await request("PATCH", "/api/messages/5/delete");

    expect(res.status).toBe(200);
    expect(valuesOf(0)).toEqual([5]);
  });

  it("404s an unknown row", async () => {
    const res = await request("PATCH", "/api/messages/5/delete");

    expect(res.status).toBe(404);
  });
});

describe("admin-only routes", () => {
  it("refuses a hard delete with no token", async () => {
    const res = await request("DELETE", "/api/messages/5");

    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("refuses a hard delete with the wrong token", async () => {
    process.env.ADMIN_TOKEN = "correct-horse";

    const res = await request("DELETE", "/api/messages/5", undefined, {
      Authorization: "Bearer nope",
    });

    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("allows a hard delete with the right token", async () => {
    process.env.ADMIN_TOKEN = "correct-horse";

    const res = await request("DELETE", "/api/messages/5", undefined, {
      Authorization: "Bearer correct-horse",
    });

    expect(res.status).toBe(200);
    expect(valuesOf(0)).toEqual([5]);
  });

  it("fails closed when ADMIN_TOKEN isn't configured at all", async () => {
    const res = await request("DELETE", "/api/messages/5", undefined, {
      Authorization: "Bearer ",
    });

    expect(res.status).toBe(401);
  });

  it("gates undelete the same way", async () => {
    const denied = await request("PATCH", "/api/messages/5/undelete");
    expect(denied.status).toBe(401);

    process.env.ADMIN_TOKEN = "correct-horse";
    sqlMock.mockResolvedValue([{ id: 5, deleted: false }]);
    const allowed = await request("PATCH", "/api/messages/5/undelete", undefined, {
      Authorization: "Bearer correct-horse",
    });
    expect(allowed.status).toBe(200);
  });
});

describe("POST /api/visits", () => {
  it("records a visit", async () => {
    const res = await request("POST", "/api/visits", { session_id: "abc", path: "/rants" });

    expect(res.status).toBe(201);
    expect(valuesOf(0)).toEqual(["abc", "/rants"]);
  });

  it("rejects a visit with no session id", async () => {
    const res = await request("POST", "/api/visits", { path: "/rants" });

    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
