// Saved scan reports. Every query is scoped to the signed-in user's id, so
// one user can never read or delete another user's report, even with a
// guessed id.

const express = require("express");
const db = require("./db");
const { requireUser, sameOrigin } = require("./auth");

// How many reports each plan keeps. When a new one is saved past the limit,
// the oldest is dropped. Change the numbers here to change the plans.
const PLAN_LIMITS = { free: 5, pro: 500, agency: 2000 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function limitFor(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

/** Saves a finished scan for a user and trims their history to their plan's limit. */
async function saveReport(user, result) {
  const limit = limitFor(user.plan);
  return db.transaction(async (q) => {
    const { rows } = await q(
      "INSERT INTO reports (user_id, url, title, violation_count, result) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [user.id, String(result.url).slice(0, 2048), String(result.title || "").slice(0, 300), result.violationCount, JSON.stringify(result)]
    );
    await q(
      `DELETE FROM reports WHERE user_id = $1 AND id NOT IN
         (SELECT id FROM reports WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2)`,
      [user.id, limit]
    );
    return { id: rows[0].id, limit };
  });
}

const router = express.Router();
router.use(requireUser);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/", async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, url, title, violation_count, created_at FROM reports WHERE user_id = $1 ORDER BY created_at DESC, id DESC",
      [req.user.id]
    );
    res.json({ plan: req.user.plan, limit: limitFor(req.user.plan), reports: rows });
  } catch (err) {
    console.error("List reports failed:", err.message);
    res.status(500).json({ error: "We couldn't load your reports. Please try again." });
  }
});

router.get("/:id", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "Report not found." });
  try {
    const { rows } = await db.query("SELECT result, created_at FROM reports WHERE id = $1 AND user_id = $2", [
      req.params.id,
      req.user.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: "Report not found." });
    res.json({ ...rows[0].result, scannedAt: rows[0].result.scannedAt || rows[0].created_at });
  } catch (err) {
    console.error("Open report failed:", err.message);
    res.status(500).json({ error: "We couldn't open that report. Please try again." });
  }
});

router.delete("/:id", sameOrigin, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "Report not found." });
  try {
    const { rows } = await db.query("DELETE FROM reports WHERE id = $1 AND user_id = $2 RETURNING id", [
      req.params.id,
      req.user.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: "Report not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete report failed:", err.message);
    res.status(500).json({ error: "We couldn't delete that report. Please try again." });
  }
});

module.exports = { reportsRouter: router, saveReport, PLAN_LIMITS };
