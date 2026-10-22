// Database access.
//
//   DATABASE_URL set          -> real Postgres (Render, Neon, Supabase...)
//   INCLINE_MEMORY_DB=1       -> Postgres running inside Node, in memory.
//                                For local development and tests only: the
//                                data is gone when the process stops.
//   neither                   -> accounts are switched off; the scanner, the
//                                guides and the rest of the site still work.
//
// All queries are plain parameterised SQL ($1, $2...), so the same code runs
// on every host.

const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

let impl = null; // { query(text, params), transaction(fn), close() }
let enabled = false;

function useSsl(connectionString) {
  const override = (process.env.DATABASE_SSL || "").toLowerCase();
  if (override === "true") return { rejectUnauthorized: false };
  if (override === "false") return false;
  // Render's internal address has no dot (dpg-abc123-a) and needs no SSL;
  // external addresses (...postgres.render.com, neon.tech) need it.
  try {
    const host = new URL(connectionString).hostname;
    return host.includes(".") ? { rejectUnauthorized: false } : false;
  } catch {
    return false;
  }
}

async function openPg(connectionString) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString, ssl: useSsl(connectionString), max: 8, connectionTimeoutMillis: 10000 });
  pool.on("error", (err) => console.error("Database pool error:", err.message));
  return {
    kind: "postgres",
    query: (text, params) => pool.query(text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn((text, params) => client.query(text, params), (sql) => client.query(sql));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openMemory() {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  return {
    kind: "memory",
    query: (text, params) => db.query(text, params),
    transaction: (fn) =>
      db.transaction((tx) => fn((text, params) => tx.query(text, params), (sql) => tx.exec(sql))),
    close: () => db.close(),
  };
}

async function runMigrations() {
  await impl.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
  );
  const done = new Set((await impl.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await impl.transaction(async (q, exec) => {
      await exec(sql); // a whole script, which q() can't run on every engine
      await q("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    console.log(`Applied migration ${file}`);
  }
}

/**
 * Connects and migrates. Never throws: if the database can't be reached the
 * site keeps running without accounts, and the reason is logged.
 */
async function init() {
  if (enabled) return true;
  try {
    if (process.env.DATABASE_URL) {
      impl = await openPg(process.env.DATABASE_URL);
    } else if (process.env.INCLINE_MEMORY_DB === "1") {
      impl = await openMemory();
      console.warn("Using an in-memory database. Accounts and reports are lost when the server stops.");
    } else {
      console.log("No DATABASE_URL set: accounts are switched off.");
      return false;
    }
    await runMigrations();
    enabled = true;
    console.log(`Database ready (${impl.kind}). Accounts are on.`);
    return true;
  } catch (err) {
    console.error("Database unavailable, accounts are switched off:", err.message);
    enabled = false;
    return false;
  }
}

function query(text, params) {
  if (!enabled) throw new Error("Database is not available");
  return impl.query(text, params);
}

function transaction(fn) {
  if (!enabled) throw new Error("Database is not available");
  return impl.transaction(fn);
}

async function close() {
  if (impl) await impl.close();
  impl = null;
  enabled = false;
}

module.exports = { init, migrate: runMigrations, query, transaction, close, isEnabled: () => enabled };
