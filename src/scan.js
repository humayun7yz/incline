// Core scan pipeline: load a URL in a real (headless) browser, inject
// axe-core into the live page, and run its accessibility audit against the
// actual rendered DOM. This is deterministic and well-established — axe-core
// is the same engine most serious accessibility tools (including Deque's
// own products) are built on — so findings here are real violations, not
// something an LLM guessed at from static markup.

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { assertPublicUrl } = require("./urlsafety");

const axeSource = fs.readFileSync(
  require.resolve("axe-core/axe.min.js"),
  "utf8"
);

const NAV_TIMEOUT_MS = 20000;

/**
 * Scans a single URL and returns axe-core's raw violations plus a
 * trimmed-down page snapshot (title + a capped slice of the rendered HTML)
 * that we can hand to the AI for plain-English explanations and fixes.
 */
// The installed @playwright/test version in this environment doesn't match
// the pre-installed browser revision's auto-discovery path, so we point
// directly at the known-good Chromium binary instead of letting Playwright
// guess (which would otherwise try to download a new browser build).
// Set CHROMIUM_PATH in the environment to override (for example on a host
// with a different browser install).
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

async function scanUrl(url) {
  const launchOptions = { headless: true };
  if (fs.existsSync(CHROMIUM_PATH)) {
    launchOptions.executablePath = CHROMIUM_PATH;
  }
  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block", // service workers would bypass request routing
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    // Safety net behind the up-front URL check: every request the browser
    // makes (the page itself, redirects, scripts, images) is re-checked, so
    // a public page can't bounce us to, or pull from, an internal address.
    // Verdicts are cached per host so a page with many assets stays fast.
    const hostVerdicts = new Map();
    await page.route("**/*", async (route) => {
      const reqUrl = route.request().url();
      if (!/^https?:/i.test(reqUrl)) return route.continue(); // data:, blob:, about:
      let host;
      try {
        host = new URL(reqUrl).host;
      } catch {
        return route.abort("blockedbyclient");
      }
      if (!hostVerdicts.has(host)) {
        hostVerdicts.set(
          host,
          assertPublicUrl(reqUrl).then(() => true, () => false)
        );
      }
      if (await hostVerdicts.get(host)) return route.continue();
      return route.abort("blockedbyclient");
    });

    await page.goto(url, { waitUntil: "load" });

    // Give lazy-rendered content (common on Shopify/React storefronts) a
    // brief moment to settle before we audit the DOM.
    await page.waitForTimeout(800);

    // Some sites (especially agency/corporate ones) run a strict Content
    // Security Policy that blocks addScriptTag's injected <script> tag
    // outright. Running the axe-core source directly through evaluate()
    // instead sidesteps that — it executes via the browser's debugging
    // protocol rather than as a DOM script element, so the page's CSP
    // script-src rules don't apply to it.
    const axeResults = await page.evaluate(`${axeSource}\naxe.run(document, { resultTypes: ["violations"] });`);

    const title = await page.title();
    const htmlSnapshot = await page.content();
    const MAX_HTML_CHARS = 12000;
    const trimmedHtml =
      htmlSnapshot.length > MAX_HTML_CHARS
        ? htmlSnapshot.slice(0, MAX_HTML_CHARS) + "\n...[truncated]"
        : htmlSnapshot;

    return {
      url,
      title,
      violations: axeResults.violations,
      htmlSnapshot: trimmedHtml,
      htmlTruncated: htmlSnapshot.length > MAX_HTML_CHARS,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { scanUrl };
