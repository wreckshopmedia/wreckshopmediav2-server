import postgres from "postgres";

// onnotice no-op silences the harmless "column already exists, skipping" NOTICEs
// the idempotent migration emits on every boot after the first
export const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
