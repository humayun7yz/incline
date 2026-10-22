// Email and password accounts.
//
//  - Passwords are hashed with scrypt and a random salt; the cost settings
//    are stored inside each hash so they can be raised later.
//  - A sign-in creates a random session token. The browser keeps it in an
//    httpOnly cookie (page scripts can't read it) and the database keeps only
//    its SHA-256, so a leaked database can't be used to hijack a session.
//  - State-changing requests must come from our own site (Origin check) on top
//    of the SameSite=Lax cookie.
//  - Login failures are rate-limited per address and per email.
//
// Not built yet: email verification and password reset. Both need an email
// sender; until then a typo in the signup email can't be recovered.

const crypto = require("crypto");
const express = require("express");
const db = require("./db");
const { rateLimit } = require("./limits");

const COOKIE_NAME = "incline_session";
const SESSION_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128;

// scrypt memory use is 128 * N * r bytes (32 MiB here). N=32768 keeps a
// sign-in under about a second even on a small shared CPU.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

function scrypt(password, salt, { N, r, p, keylen, maxmem }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize("NFKC"), salt, keylen, { N, r, p, maxmem }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const params = { N: +N, r: +r, p: +p, keylen: expected.length, maxmem: SCRYPT.maxmem };
  if (!params.N || !params.r || !params.p || !expected.length) return false;
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), params);
  return crypto.timingSafeEqual(actual, expected);
}

// A real hash to compare against when the email isn't registered, so a login
// for an unknown address takes as long as one for a known address.
let dummyHash = null;
async function spendTime(password) {
  if (!dummyHash) dummyHash = await hashPassword("not-a-real-password");
  await verifyPassword(password, dummyHash);
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // ignore a malformed cookie value
    }
  }
  return out;
}

function cookieOptions(req) {
  return { httpOnly: true, sameSite: "lax", secure: Boolean(req.secure), path: "/" };
}

async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)",
    [userId, sha256(token), String(SESSION_DAYS)]
  );
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(req), maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 });
}

/** Sets req.user ({id, email, plan}) when the request carries a valid session. */
async function attachUser(req, res, next) {
  req.user = null;
  if (!db.isEnabled()) return next();
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token || token.length > 200) return next();
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.plan FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)]
    );
    if (rows[0]) req.user = rows[0];
  } catch (err) {
    console.error("Session lookup failed:", err.message);
  }
  next();
}

function requireAccounts(req, res, next) {
  if (!db.isEnabled()) return res.status(503).json({ error: "Accounts aren't available yet." });
  next();
}

function requireUser(req, res, next) {
  if (!db.isEnabled()) return res.status(503).json({ error: "Accounts aren't available yet." });
  if (!req.user) return res.status(401).json({ error: "Please log in to continue." });
  next();
}

/** Rejects state-changing requests that come from another website. */
function sameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      // fall through: host stays empty and the request is refused
    }
    if (host !== req.get("host")) return res.status(403).json({ error: "This request isn't allowed." });
  }
  next();
}

// Failed logins per email, so one account can't be guessed at from many addresses.
const failures = new Map();
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
}, 60 * 1000).unref();

function tooManyFailures(email) {
  const entry = failures.get(email);
  return Boolean(entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILURES);
}
function recordFailure(email) {
  const now = Date.now();
  const entry = failures.get(email);
  if (!entry || entry.resetAt <= now) failures.set(email, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
  else entry.count += 1;
}

function readCredentials(body) {
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  return { email, password };
}

const router = express.Router();

router.get("/me", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ accountsEnabled: db.isEnabled(), user: req.user ? { email: req.user.email, plan: req.user.plan } : null });
});

router.post(
  "/signup",
  requireAccounts,
  sameOrigin,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: "Too many sign-ups from this connection. Please try again later." }),
  async (req, res) => {
    const { email, password } = readCredentials(req.body);
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Your password needs at least ${MIN_PASSWORD} characters.` });
    }
    if (password.length > MAX_PASSWORD) {
      return res.status(400).json({ error: `Your password can be at most ${MAX_PASSWORD} characters.` });
    }
    if (password.toLowerCase() === email) {
      return res.status(400).json({ error: "Your password can't be the same as your email address." });
    }
    try {
      const hash = await hashPassword(password);
      const { rows } = await db.query(
        "INSERT INTO users (email, password_hash, last_login_at) VALUES ($1, $2, now()) RETURNING id, email, plan",
        [email, hash]
      );
      await startSession(req, res, rows[0].id);
      res.status(201).json({ user: { email: rows[0].email, plan: rows[0].plan } });
    } catch (err) {
      if (err && err.code === "23505") {
        return res.status(409).json({ error: "An account with this email already exists. Try logging in." });
      }
      console.error("Signup failed:", err.message);
      res.status(500).json({ error: "We couldn't create your account. Please try again." });
    }
  }
);

router.post(
  "/login",
  requireAccounts,
  sameOrigin,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: "Too many login attempts. Please wait a few minutes and try again." }),
  async (req, res) => {
    const { email, password } = readCredentials(req.body);
    if (!email || !password || email.length > 254 || password.length > MAX_PASSWORD) {
      return res.status(400).json({ error: "Enter your email and password." });
    }
    if (tooManyFailures(email)) {
      return res.status(429).json({ error: "Too many failed attempts for this account. Please wait 15 minutes and try again." });
    }
    try {
      const { rows } = await db.query("SELECT id, email, plan, password_hash FROM users WHERE email = $1", [email]);
      const user = rows[0];
      const ok = user ? await verifyPassword(password, user.password_hash) : (await spendTime(password), false);
      if (!ok) {
        recordFailure(email);
        return res.status(401).json({ error: "That email and password don't match." });
      }
      failures.delete(email);
      await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
      await db.query("DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()", [user.id]);
      await startSession(req, res, user.id);
      res.json({ user: { email: user.email, plan: user.plan } });
    } catch (err) {
      console.error("Login failed:", err.message);
      res.status(500).json({ error: "We couldn't log you in. Please try again." });
    }
  }
);

router.post("/logout", sameOrigin, async (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token && db.isEnabled()) {
    try {
      await db.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
    } catch (err) {
      console.error("Logout failed:", err.message);
    }
  }
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
  res.json({ ok: true });
});

module.exports = { authRouter: router, attachUser, requireUser, sameOrigin, hashPassword, verifyPassword, COOKIE_NAME };
