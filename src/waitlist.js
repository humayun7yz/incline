// Waitlist signups for the Pro and Agency plans.
//
// Where signups are kept: every signup is written to data/waitlist.jsonl AND
// printed to the server log as a WAITLIST_SIGNUP line. On Render's free tier
// the disk is wiped on every restart or deploy, so the log line is the
// record to copy out until accounts and a database exist. Emails are
// personal data: don't paste these log lines anywhere public.

const fs = require("fs");
const path = require("path");
const { rateLimit } = require("./limits");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "waitlist.jsonl");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const seen = new Set();
try {
  for (const line of fs.readFileSync(FILE, "utf8").split("\n")) {
    if (line.trim()) seen.add(JSON.parse(line).email);
  }
} catch {
  // No file yet, or an unreadable line: start with an empty list.
}

const limit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many sign-ups from this connection. Please try again later.",
});

function handler(req, res) {
  const body = req.body || {};

  // Bots fill the hidden "website" field; people never see it. Pretend it
  // worked so the bot learns nothing, and store nothing.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return res.json({ ok: true });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  // Same answer for a repeat sign-up, so the form can't be used to check
  // who is already on the list.
  if (seen.has(email)) return res.json({ ok: true });
  seen.add(email);

  const record = { email, at: new Date().toISOString() };
  console.log("WAITLIST_SIGNUP " + JSON.stringify(record));
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(record) + "\n");
  } catch (err) {
    // The log line above is still a record, so don't fail the visitor.
    console.error("Could not write waitlist file:", err.message);
  }
  res.json({ ok: true });
}

module.exports = { waitlistRoute: [limit, handler] };
