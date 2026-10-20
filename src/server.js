const express = require("express");
const path = require("path");
const { scanUrl } = require("./scan");
const { explainAndFix } = require("./report");
const { assertPublicUrl } = require("./urlsafety");
const { scanLimits } = require("./limits");

const app = express();
// Render puts one proxy in front of the app; trusting exactly one hop makes
// req.ip the real visitor address, which the rate limiter relies on.
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

// Server-side AI config: this is the hosted-SaaS model, not Mark's
// bring-your-own-key extension model. WE pay the AI cost per scan, so the
// key lives in an env var here, never in the client-facing form.
const AI_CONFIG = {
  provider: process.env.A11Y_AI_PROVIDER || "anthropic",
  apiKey: process.env.A11Y_AI_KEY || "",
  model: process.env.A11Y_AI_MODEL || "",
};

app.post("/api/scan", scanLimits, async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string" || url.length > 2048) {
    return res.status(400).json({ error: "Please provide a valid http(s) URL." });
  }
  try {
    await assertPublicUrl(url);
  } catch (urlErr) {
    return res.status(400).json({ error: urlErr.message });
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
      steps: explanations[v.id]?.steps || [],
      fix: explanations[v.id]?.fix || null,
      risk: explanations[v.id]?.risk || "",
      also: explanations[v.id]?.also || "",
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
    // Log the real error for us, but don't send browser/internal details
    // (file paths, stack hints) back to the visitor.
    console.error("Scan failed:", err.message || err);
    res.status(500).json({
      error: "We couldn't scan that page. It may be down, blocking automated visitors, or too slow to load.",
    });
  }
});

const PORT = process.env.PORT || 3300;
app.listen(PORT, () => {
  console.log(`a11y-scanner listening on http://localhost:${PORT}`);
});
