const express = require("express");
const path = require("path");
const { scanUrl } = require("./scan");
const { explainAndFix } = require("./report");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Server-side AI config: this is the hosted-SaaS model, not Mark's
// bring-your-own-key extension model. WE pay the AI cost per scan, so the
// key lives in an env var here, never in the client-facing form.
const AI_CONFIG = {
  provider: process.env.A11Y_AI_PROVIDER || "anthropic",
  apiKey: process.env.A11Y_AI_KEY || "",
  model: process.env.A11Y_AI_MODEL || "",
};

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

app.post("/api/scan", async (req, res) => {
  const { url } = req.body || {};
  if (!url || !isValidHttpUrl(url)) {
    return res.status(400).json({ error: "Please provide a valid http(s) URL." });
  }

  try {
    const scanResult = await scanUrl(url);

    let explanations = {};
    if (scanResult.violations.length > 0 && AI_CONFIG.apiKey) {
      try {
        explanations = await explainAndFix(scanResult.violations, AI_CONFIG);
      } catch (aiErr) {
        // Scanning itself is the reliable, deterministic part — if the AI
        // explanation step fails (bad key, rate limit, network), we still
        // return the real axe-core findings rather than failing the whole
        // scan over a secondary feature.
        console.error("AI explain step failed:", aiErr.message || aiErr);
      }
    }

    const violations = scanResult.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      helpUrl: v.helpUrl,
      nodeCount: v.nodes.length,
      exampleHtml: v.nodes[0]?.html || "",
      explain: explanations[v.id]?.explain || "",
      fix: explanations[v.id]?.fix || null,
    }));

    res.json({
      url: scanResult.url,
      title: scanResult.title,
      scannedAt: new Date().toISOString(),
      violationCount: violations.length,
      violations,
      aiAvailable: Boolean(AI_CONFIG.apiKey),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 3300;
app.listen(PORT, () => {
  console.log(`a11y-scanner listening on http://localhost:${PORT}`);
});
