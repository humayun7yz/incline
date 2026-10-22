#!/usr/bin/env node
// End-to-end tests for accounts and saved reports. Runs the real server and
// the real SQL (Postgres running in memory), with the browser scan replaced
// by a stub so no network is needed.   Run: node scripts/test-accounts.js

process.env.INCLINE_MEMORY_DB = "1";
process.env.SCAN_LIMIT_PER_10_MIN = "1000";
process.env.SCAN_LIMIT_PER_DAY = "1000";

const path = require("path");
const { spawn } = require("child_process");

// Replace the browser scan with a stub.
const scanPath = require.resolve("../src/scan");
require.cache[scanPath] = {
  id: scanPath,
  filename: scanPath,
  loaded: true,
  exports: {
    scanUrl: async (url) => ({
      url,
      title: "Stub page",
      violations: [{ id: "image-alt", impact: "critical", help: "Images must have alternate text", helpUrl: "https://example.test/image-alt", nodes: [{ html: "<img src=a.jpg>", target: ["img"] }] }],
    }),
  },
};

const { app, ready } = require("../src/server");
const db = require("../src/db");

let failures = 0;
let checks = 0;
function check(ok, label) {
  checks++;
  if (!ok) {
    failures++;
    console.log("FAIL", label);
  }
}

let base = "";
async function call(method, url, { body, cookie, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let payload;
  if (raw !== undefined) {
    payload = raw;
  } else if (body !== undefined) {
    h["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers: h, body: payload });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // not JSON
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, setCookie };
}

function cookieFrom(res) {
  const c = res.setCookie.find((x) => x.startsWith("incline_session="));
  return c ? c.split(";")[0] : null;
}

const PW = "correct horse battery";

async function main() {
  await ready;
  check(db.isEnabled(), "database is enabled in test mode");
  const server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  // ---- anonymous basics
  let r = await call("GET", "/api/auth/me");
  check(r.status === 200 && r.json.accountsEnabled === true && r.json.user === null, "anonymous /me: accounts on, no user");
  r = await call("GET", "/api/reports");
  check(r.status === 401, "anonymous cannot list reports");

  // ---- signup validation
  r = await call("POST", "/api/auth/signup", { body: { email: "nope", password: PW } });
  check(r.status === 400, "signup rejects a bad email");
  r = await call("POST", "/api/auth/signup", { body: { email: "a@example.com", password: "short" } });
  check(r.status === 400 && /10 characters/.test(r.json.error), "signup rejects a short password");
  r = await call("POST", "/api/auth/signup", { body: { email: "a@example.com", password: "x".repeat(129) } });
  check(r.status === 400, "signup rejects a 129-character password");
  r = await call("POST", "/api/auth/signup", { body: { email: "samepass@example.com", password: "samepass@example.com" } });
  check(r.status === 400, "signup rejects password equal to email");
  r = await call("POST", "/api/auth/signup", { body: { email: 42, password: PW } });
  check(r.status === 400, "signup rejects non-string email");
  r = await call("POST", "/api/auth/signup", { raw: "email=a@example.com&password=" + PW, headers: { "content-type": "text/plain" } });
  check(r.status === 400, "signup rejects a non-JSON body");

  // ---- signup, cookie flags, stored data
  r = await call("POST", "/api/auth/signup", { body: { email: "  Alice@Example.COM ", password: PW } });
  check(r.status === 201 && r.json.user.email === "alice@example.com" && r.json.user.plan === "free", "signup works and normalises the email");
  const aliceCookie = cookieFrom(r);
  const rawSetCookie = r.setCookie.find((x) => x.startsWith("incline_session="));
  check(/HttpOnly/i.test(rawSetCookie), "session cookie is HttpOnly");
  check(/SameSite=Lax/i.test(rawSetCookie), "session cookie is SameSite=Lax");
  check(/Max-Age=2592000/i.test(rawSetCookie), "session cookie lasts 30 days");
  check(!/;\s*Secure/i.test(rawSetCookie), "no Secure flag over plain http (local test)");

  const stored = (await db.query("SELECT password_hash FROM users WHERE email = $1", ["alice@example.com"])).rows[0].password_hash;
  check(stored.startsWith("scrypt$32768$8$1$") && !stored.includes(PW), "password stored as a scrypt hash, not plain text");
  const token = aliceCookie.split("=")[1];
  const sessRows = (await db.query("SELECT token_hash FROM sessions")).rows;
  check(sessRows.length === 1 && sessRows[0].token_hash.length === 64 && sessRows[0].token_hash !== token, "database stores only a hash of the session token");

  r = await call("GET", "/api/auth/me", { cookie: aliceCookie });
  check(r.json.user && r.json.user.email === "alice@example.com", "/me recognises the session");

  r = await call("POST", "/api/auth/signup", { body: { email: "ALICE@example.com", password: PW } });
  check(r.status === 409, "duplicate email (different case) is refused");

  // ---- tampered / unknown cookies
  r = await call("GET", "/api/auth/me", { cookie: "incline_session=not-a-real-token" });
  check(r.json.user === null, "unknown session token means signed out");
  r = await call("GET", "/api/auth/me", { cookie: "incline_session=%E0%A4%A" });
  check(r.status === 200 && r.json.user === null, "malformed cookie does not crash");

  // ---- login
  r = await call("POST", "/api/auth/login", { body: { email: "alice@example.com", password: "wrong password!" } });
  const wrongMsg = r.json && r.json.error;
  check(r.status === 401, "wrong password is refused");
  r = await call("POST", "/api/auth/login", { body: { email: "nobody@example.com", password: "wrong password!" } });
  check(r.status === 401 && r.json.error === wrongMsg, "unknown email gives the same message as a wrong password");
  r = await call("POST", "/api/auth/login", { body: { email: "ALICE@example.com", password: PW } });
  check(r.status === 200 && cookieFrom(r) && cookieFrom(r) !== aliceCookie, "login works (any case) and issues a new session");
  const aliceCookie2 = cookieFrom(r);

  // ---- cross-site requests
  r = await call("POST", "/api/auth/login", { body: { email: "alice@example.com", password: PW }, headers: { origin: "https://evil.example" } });
  check(r.status === 403, "login from another site is blocked");
  r = await call("POST", "/api/auth/login", { body: { email: "alice@example.com", password: PW }, headers: { origin: base } });
  check(r.status === 200, "login from our own origin is allowed");

  // ---- lockout
  await call("POST", "/api/auth/signup", { body: { email: "victim@example.com", password: PW } });
  let last;
  for (let i = 0; i < 8; i++) last = await call("POST", "/api/auth/login", { body: { email: "victim@example.com", password: "guess number " + i } });
  check(last.status === 401, "first 8 wrong guesses are answered normally");
  r = await call("POST", "/api/auth/login", { body: { email: "victim@example.com", password: PW } });
  check(r.status === 429, "after 8 failures even the right password is locked out for a while");

  // ---- logout
  r = await call("POST", "/api/auth/logout", { cookie: aliceCookie2 });
  check(r.status === 200 && r.setCookie.some((c) => /incline_session=;/.test(c)), "logout clears the cookie");
  r = await call("GET", "/api/auth/me", { cookie: aliceCookie2 });
  check(r.json.user === null, "the logged-out session no longer works on the server");
  r = await call("GET", "/api/auth/me", { cookie: aliceCookie });
  check(r.json.user !== null, "other sessions of the same user are unaffected");

  // ---- expired session
  await db.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
  r = await call("GET", "/api/auth/me", { cookie: aliceCookie });
  check(r.json.user === null, "expired session is rejected");
  r = await call("POST", "/api/auth/login", { body: { email: "alice@example.com", password: PW } });
  const alice = cookieFrom(r);
  const aliceExpired = (await db.query("SELECT count(*)::int c FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'alice@example.com' AND s.expires_at <= now()")).rows[0].c;
  check(aliceExpired === 0, "logging in removes that user's expired sessions");
  const victimExpired = (await db.query("SELECT count(*)::int c FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'victim@example.com' AND s.expires_at <= now()")).rows[0].c;
  check(victimExpired > 0, "(sanity) another user's expired sessions were left alone");

  // ---- scans and saved reports
  r = await call("POST", "/api/scan", { body: { url: "http://8.8.8.8/" } });
  check(r.status === 200 && r.json.saved === undefined && r.json.reportId === undefined, "anonymous scan works and is not saved");
  r = await call("POST", "/api/scan", { body: { url: "http://8.8.8.8/" }, cookie: alice });
  check(r.status === 200 && r.json.saved === true && /^[0-9a-f-]{36}$/.test(r.json.reportId) && r.json.savedLimit === 5, "signed-in scan is saved (free limit 5)");
  const firstReport = r.json.reportId;

  r = await call("GET", "/api/reports", { cookie: alice });
  check(r.status === 200 && r.json.reports.length === 1 && r.json.limit === 5 && r.json.plan === "free", "list shows the saved report");
  check(!("result" in r.json.reports[0]), "list does not include the full result");
  r = await call("GET", "/api/reports/" + firstReport, { cookie: alice });
  check(r.status === 200 && r.json.url === "http://8.8.8.8/" && r.json.violations.length === 1, "owner can open the full report");

  // ---- another user cannot touch it
  r = await call("POST", "/api/auth/signup", { body: { email: "bob@example.com", password: PW } });
  const bob = cookieFrom(r);
  r = await call("GET", "/api/reports/" + firstReport, { cookie: bob });
  check(r.status === 404, "another user cannot open Alice's report");
  r = await call("DELETE", "/api/reports/" + firstReport, { cookie: bob });
  check(r.status === 404, "another user cannot delete Alice's report");
  r = await call("GET", "/api/reports", { cookie: bob });
  check(r.json.reports.length === 0, "Bob's list does not include Alice's report");
  r = await call("GET", "/api/reports/not-a-uuid", { cookie: alice });
  check(r.status === 404, "a malformed report id gives 404, not an error");
  r = await call("GET", "/api/reports/../auth/me", { cookie: alice });
  check(r.status !== 500, "path tricks do not cause a server error");

  // ---- free limit trims history
  for (let i = 0; i < 6; i++) await call("POST", "/api/scan", { body: { url: "http://8.8.8.8/?n=" + i }, cookie: alice });
  r = await call("GET", "/api/reports", { cookie: alice });
  check(r.json.reports.length === 5, "free plan keeps only the last 5 reports (got " + r.json.reports.length + ")");
  check(!r.json.reports.some((x) => x.id === firstReport), "the oldest report was the one dropped");
  r = await call("GET", "/api/reports/" + firstReport, { cookie: alice });
  check(r.status === 404, "the dropped report can no longer be opened");

  // ---- pro limit
  await db.query("UPDATE users SET plan = 'pro' WHERE email = 'alice@example.com'");
  r = await call("GET", "/api/reports", { cookie: alice });
  check(r.json.plan === "pro" && r.json.limit === 500, "pro plan shows a much higher limit");

  // ---- delete
  const toDelete = r.json.reports[0].id;
  r = await call("DELETE", "/api/reports/" + toDelete, { cookie: alice, headers: { origin: "https://evil.example" } });
  check(r.status === 403, "delete from another site is blocked");
  r = await call("DELETE", "/api/reports/" + toDelete, { cookie: alice });
  check(r.status === 200, "owner can delete a report");
  r = await call("DELETE", "/api/reports/" + toDelete, { cookie: alice });
  check(r.status === 404, "deleting twice gives 404");

  // ---- deleting a user removes their data
  await db.query("DELETE FROM users WHERE email = 'bob@example.com'");
  const orphans = (await db.query("SELECT (SELECT count(*) FROM sessions s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id))::int a, (SELECT count(*) FROM reports r WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id))::int b")).rows[0];
  check(orphans.a === 0 && orphans.b === 0, "no orphaned sessions or reports after deleting a user");

  server.close();
  await db.close();

  // ---- no-database mode, in a separate process
  await new Promise((resolve) => {
    const env = { ...process.env, PORT: "3459" };
    delete env.INCLINE_MEMORY_DB;
    delete env.DATABASE_URL;
    const child = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.js")], { env, stdio: "ignore" });
    setTimeout(async () => {
      try {
        base = "http://127.0.0.1:3459";
        let m = await call("GET", "/api/auth/me");
        check(m.status === 200 && m.json.accountsEnabled === false && m.json.user === null, "no database: /me says accounts are off");
        m = await call("POST", "/api/auth/login", { body: { email: "a@example.com", password: PW } });
        check(m.status === 503, "no database: login answers 503, not a crash");
        m = await call("POST", "/api/auth/signup", { body: { email: "a@example.com", password: PW } });
        check(m.status === 503, "no database: signup answers 503");
        m = await call("GET", "/api/reports");
        check(m.status === 503, "no database: reports answer 503");
        m = await call("POST", "/api/scan", { body: { url: "http://10.0.0.1/" } });
        check(m.status === 400, "no database: the scanner still validates and runs");
        const home = await fetch(base + "/");
        check(home.status === 200, "no database: the home page still loads");
      } catch (err) {
        check(false, "no-database check crashed: " + err.message);
      }
      child.kill();
      resolve();
    }, 2500);
  });

  console.log(failures ? `${failures} of ${checks} checks FAILED` : `ALL ${checks} CHECKS PASSED`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
