import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  normalizeColor,
  parseId,
  validateMessage,
  validatePlacement,
  validateVisit,
} from "./validation";

describe("validateMessage", () => {
  it("accepts a normal note and trims the whitespace", () => {
    const result = validateMessage({ name: "  Mo  ", message: "  boats belong in trees  " });
    expect(result).toEqual({
      ok: true,
      value: { name: "Mo", message: "boats belong in trees", color: null },
    });
  });

  it("falls back to Anonymous when the name is missing or blank", () => {
    expect(validateMessage({ message: "hi" })).toMatchObject({ value: { name: "Anonymous" } });
    expect(validateMessage({ name: "   ", message: "hi" })).toMatchObject({
      value: { name: "Anonymous" },
    });
  });

  it("rejects an empty or whitespace-only message", () => {
    expect(validateMessage({ message: "" }).ok).toBe(false);
    expect(validateMessage({ message: "    " }).ok).toBe(false);
  });

  it("rejects a message past the cap but accepts one exactly at it", () => {
    expect(validateMessage({ message: "x".repeat(MAX_MESSAGE_LENGTH) }).ok).toBe(true);
    expect(validateMessage({ message: "x".repeat(MAX_MESSAGE_LENGTH + 1) }).ok).toBe(false);
  });

  it("rejects a name past the cap", () => {
    expect(validateMessage({ name: "x".repeat(MAX_NAME_LENGTH + 1), message: "hi" }).ok).toBe(false);
  });

  it("rejects non-string fields and non-object bodies", () => {
    expect(validateMessage({ message: 42 }).ok).toBe(false);
    expect(validateMessage({ name: 42, message: "hi" }).ok).toBe(false);
    expect(validateMessage({ message: "hi", color: "red" }).ok).toBe(false);
    expect(validateMessage(null).ok).toBe(false);
    expect(validateMessage("hi").ok).toBe(false);
    expect(validateMessage([{ message: "hi" }]).ok).toBe(false);
  });

  it("keeps a client-supplied color and wraps it into the palette", () => {
    expect(validateMessage({ message: "hi", color: 2 })).toMatchObject({ value: { color: 2 } });
    expect(validateMessage({ message: "hi", color: 7 })).toMatchObject({ value: { color: 2 } });
    expect(validateMessage({ message: "hi", color: -1 })).toMatchObject({ value: { color: 4 } });
  });
});

describe("validatePlacement", () => {
  it("accepts in-range fractions and rotation", () => {
    expect(validatePlacement({ pos_x: 0.5, pos_y: 0.25, rotation: -12 })).toEqual({
      ok: true,
      value: { pos_x: 0.5, pos_y: 0.25, rotation: -12 },
    });
  });

  it("accepts the exact 0 and 1 edges", () => {
    expect(validatePlacement({ pos_x: 0, pos_y: 1, rotation: 360 }).ok).toBe(true);
  });

  it("rejects fractions outside 0-1", () => {
    expect(validatePlacement({ pos_x: 1.2, pos_y: 0.5, rotation: 0 }).ok).toBe(false);
    expect(validatePlacement({ pos_x: 0.5, pos_y: -0.1, rotation: 0 }).ok).toBe(false);
  });

  it("rejects NaN, Infinity and strings so Postgres never sees junk", () => {
    expect(validatePlacement({ pos_x: NaN, pos_y: 0.5, rotation: 0 }).ok).toBe(false);
    expect(validatePlacement({ pos_x: Infinity, pos_y: 0.5, rotation: 0 }).ok).toBe(false);
    expect(validatePlacement({ pos_x: "0.5", pos_y: 0.5, rotation: 0 }).ok).toBe(false);
    expect(validatePlacement({ pos_x: 0.5, pos_y: 0.5 }).ok).toBe(false);
  });
});

describe("validateVisit", () => {
  it("accepts a session id and path", () => {
    expect(validateVisit({ session_id: "abc", path: "/rants" })).toEqual({
      ok: true,
      value: { session_id: "abc", path: "/rants" },
    });
  });

  it("rejects missing, empty or oversized fields", () => {
    expect(validateVisit({ path: "/rants" }).ok).toBe(false);
    expect(validateVisit({ session_id: "abc", path: "" }).ok).toBe(false);
    expect(validateVisit({ session_id: "x".repeat(201), path: "/rants" }).ok).toBe(false);
  });
});

describe("parseId", () => {
  it("accepts positive whole numbers", () => {
    expect(parseId("1")).toBe(1);
    expect(parseId("4321")).toBe(4321);
  });

  it("rejects anything that is not a positive integer", () => {
    expect(parseId("0")).toBeNull();
    expect(parseId("-3")).toBeNull();
    expect(parseId("1.5")).toBeNull();
    expect(parseId("abc")).toBeNull();
    expect(parseId("")).toBeNull();
    expect(parseId("1; DROP TABLE messages")).toBeNull();
  });
});

describe("normalizeColor", () => {
  it("wraps into the palette in both directions", () => {
    expect(normalizeColor(0)).toBe(0);
    expect(normalizeColor(5)).toBe(0);
    expect(normalizeColor(6)).toBe(1);
    expect(normalizeColor(-1)).toBe(4);
    expect(normalizeColor(2.7)).toBe(2);
  });
});
