/**
 * Pure request-body validators for the public API. No database, no Hono, no I/O -
 * which is exactly why these are the easy things to test. Routes stay thin and just
 * translate a failed result into a 400.
 * @author Chris "Mo" Mochinski
 */

/** How many colors the sticky-note palette cycles through (must match the client). */
export const PALETTE_SIZE = 5;

/** Mirrors the compose pad's caps in ComposePad.tsx - keep the two in sync. */
export const MAX_MESSAGE_LENGTH = 165;
export const MAX_NAME_LENGTH = 35;

/** Visits are internal telemetry, so the caps are just anti-garbage, not product rules. */
export const MAX_VISIT_FIELD_LENGTH = 200;

/** A validated value, or the reason it was rejected. */
export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export interface MessageInput {
  name: string;
  message: string;
  /** Null means the client didn't pick one, so the server derives it from the newest row. */
  color: number | null;
}

export interface PlacementInput {
  pos_x: number;
  pos_y: number;
  rotation: number;
}

export interface VisitInput {
  session_id: string;
  path: string;
}

/** @description Narrows an unknown parsed body to a plain object we can read keys off. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @description Wraps a palette index into 0..PALETTE_SIZE-1, including negatives
 * (JS % keeps the sign, so -1 % 5 is -1 and we want 4).
 */
export function normalizeColor(color: number): number {
  return ((Math.trunc(color) % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
}

/**
 * @description Validates a row id coming off the URL. Ids are SERIAL, so anything
 * that isn't a positive whole number is a 404 rather than a query we bother running.
 */
export function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

/**
 * @description Validates a new sticky note. Message is the only required field; name
 * falls back to "Anonymous" the same way the client does, and color is optional.
 */
export function validateMessage(body: unknown): Validated<MessageInput> {
  if (!isPlainObject(body)) return { ok: false, error: "body must be a JSON object" };

  const { name, message, color } = body;

  if (typeof message !== "string") return { ok: false, error: "message must be a string" };
  const trimmedMessage = message.trim();
  if (trimmedMessage.length === 0) return { ok: false, error: "message cannot be empty" };
  if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `message cannot exceed ${MAX_MESSAGE_LENGTH} characters` };
  }

  if (name !== undefined && name !== null && typeof name !== "string") {
    return { ok: false, error: "name must be a string" };
  }
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (trimmedName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `name cannot exceed ${MAX_NAME_LENGTH} characters` };
  }

  if (color !== undefined && color !== null && !isFiniteNumber(color)) {
    return { ok: false, error: "color must be a number" };
  }

  return {
    ok: true,
    value: {
      name: trimmedName || "Anonymous",
      message: trimmedMessage,
      color: isFiniteNumber(color) ? normalizeColor(color) : null,
    },
  };
}

/**
 * @description Validates a drag-drop placement. pos_x / pos_y are 0-1 fractions of the
 * canvas so they stay responsive, and rotation is a sane-looking degree value. Anything
 * out of range is a client bug, so we reject instead of writing junk into REAL columns.
 */
export function validatePlacement(body: unknown): Validated<PlacementInput> {
  if (!isPlainObject(body)) return { ok: false, error: "body must be a JSON object" };

  const { pos_x, pos_y, rotation } = body;

  if (!isFiniteNumber(pos_x) || pos_x < 0 || pos_x > 1) {
    return { ok: false, error: "pos_x must be a number between 0 and 1" };
  }
  if (!isFiniteNumber(pos_y) || pos_y < 0 || pos_y > 1) {
    return { ok: false, error: "pos_y must be a number between 0 and 1" };
  }
  if (!isFiniteNumber(rotation) || rotation < -360 || rotation > 360) {
    return { ok: false, error: "rotation must be a number between -360 and 360" };
  }

  return { ok: true, value: { pos_x, pos_y, rotation } };
}

/** @description Validates a visit ping. Both fields are optional-ish but must be short strings. */
export function validateVisit(body: unknown): Validated<VisitInput> {
  if (!isPlainObject(body)) return { ok: false, error: "body must be a JSON object" };

  const { session_id, path } = body;

  if (typeof session_id !== "string" || session_id.length === 0) {
    return { ok: false, error: "session_id must be a non-empty string" };
  }
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, error: "path must be a non-empty string" };
  }
  if (session_id.length > MAX_VISIT_FIELD_LENGTH || path.length > MAX_VISIT_FIELD_LENGTH) {
    return { ok: false, error: `fields cannot exceed ${MAX_VISIT_FIELD_LENGTH} characters` };
  }

  return { ok: true, value: { session_id, path } };
}

/** @description True only for real numbers, so NaN and Infinity never reach Postgres. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
