// Core scan pipeline: load a URL in a real (headless) browser, inject
// axe-core into the live page, and run its accessibility audit against the
// actual rendered DOM. This is deterministic and well-established — axe-core
// is the same engine most serious accessibility tools (including Deque's
// own products) are built on — so findings here are real violations, not
// something an LLM guessed at from static markup.

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

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
const CHROMIUM_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

async function scanUrl(url) {
  const launchOptions = { headless: true };
  if (fs.existsSync(CHROMIUM_PATH)) {
    launchOptions.executablePath = CHROMIUM_PATH;
  } else {
    // On hosts like Render we only install the regular Chromium build
    // (not the separate "headless shell" variant Playwright defaults to
    // in headless mode), so force the "chromium" channel to use the
    // build that's actually present.
    launchOptions.channel = "chromium";
  }
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    await page.goto(url, { waitUntil: "load" });

    // Give lazy-rendered content (common on Shopify/React storefronts) a
    // brief moment to settle before we audit the DOM.
    await page.waitForTimeout(800);

    await page.addScriptTag({ content: axeSource });
    const axeResults = await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      return axe.run(document, {
        resultTypes: ["violations"],
      });
    });

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
