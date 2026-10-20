#!/usr/bin/env node
// Checks every fix guide in content/rules/*.json:
//   1. the JSON matches the schema (required fields, sensible lengths)
//   2. the "before" snippet really makes axe-core report that rule
//   3. the "after" snippet makes axe-core report nothing at all
// so the code samples we publish are proven against the same engine the
// scanner uses, not just plausible-looking.
//
// Usage: node scripts/verify-guides.js [rule-id ...]
// With no arguments it checks every file. Exit code is 1 if anything failed.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RULES_DIR = path.join(__dirname, "..", "content", "rules");
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const CHROMIUM_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const IMPACTS = ["critical", "serious", "moderate", "minor"];

function wrap(snippet, isDoc) {
  if (isDoc) return snippet;
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Test page</title></head><body><main><h1>Test page</h1>" +
    snippet +
    "</main></body></html>"
  );
}

function validateSchema(g, fileId) {
  const errs = [];
  const str = (k, min, max) => {
    if (typeof g[k] !== "string" || !g[k].trim()) errs.push(`${k}: missing or empty`);
    else if (g[k].length < min || g[k].length > max) errs.push(`${k}: length ${g[k].length} outside ${min}-${max}`);
  };
  if (g.id !== fileId) errs.push(`id "${g.id}" does not match file name "${fileId}"`);
  str("title", 12, 70);
  if (!IMPACTS.includes(g.typicalImpact)) errs.push(`typicalImpact must be one of ${IMPACTS.join(", ")}`);
  str("summary", 60, 160);
  str("problem", 80, 600);
  str("whoItAffects", 80, 600);
  str("whyItMatters", 80, 600);
  str("howToCheck", 40, 400);
  str("before", 10, 1800);
  str("after", 10, 1800);
  if (typeof g.doc !== "boolean") errs.push("doc: must be true or false");
  if (!Array.isArray(g.steps) || g.steps.length < 3 || g.steps.length > 5) errs.push("steps: need 3-5 items");
  else g.steps.forEach((s, i) => { if (typeof s !== "string" || s.length < 15 || s.length > 400) errs.push(`steps[${i}]: bad length`); });
  if (g.platformNotes !== undefined) {
    if (!Array.isArray(g.platformNotes) || g.platformNotes.length > 3) errs.push("platformNotes: array of at most 3");
    else g.platformNotes.forEach((p, i) => {
      if (!p || typeof p.platform !== "string" || typeof p.note !== "string") errs.push(`platformNotes[${i}]: need platform and note strings`);
    });
  }
  if (!Array.isArray(g.related) || g.related.length > 6) errs.push("related: array of at most 6 rule ids");
  // House style: no em dashes, no filler words.
  const prose = [g.title, g.summary, g.problem, g.whoItAffects, g.whyItMatters, g.howToCheck, ...(g.steps || []),
    ...((g.platformNotes || []).map((p) => p.note))].join("\n");
  if (/—|–/.test(prose)) errs.push("prose contains an em/en dash (use a comma, colon or new sentence)");
  const banned = prose.match(/\b(genuinely|honestly|straightforward|simply|just|easily|seamless(ly)?|leverage|robust)\b/gi);
  if (banned) errs.push(`prose contains banned words: ${[...new Set(banned.map((b) => b.toLowerCase()))].join(", ")}`);
  if (/\d+\s?%/.test(prose)) errs.push("prose contains a percentage; do not state statistics");
  return errs;
}

async function runAxe(page, html, ruleId, onlyThisRule) {
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(axeSource);
  return page.evaluate(
    ({ ruleId, onlyThisRule }) =>
      // eslint-disable-next-line no-undef
      axe.run(document, onlyThisRule ? { runOnly: { type: "rule", values: [ruleId] }, resultTypes: ["violations"] } : { resultTypes: ["violations"] }),
    { ruleId, onlyThisRule }
  );
}

async function main() {
  const wanted = process.argv.slice(2);
  const files = fs.readdirSync(RULES_DIR).filter((f) => f.endsWith(".json")).sort();
  const targets = files.filter((f) => !wanted.length || wanted.includes(f.replace(/\.json$/, "")));
  if (!targets.length) {
    console.log("No guide files matched.");
    process.exit(wanted.length ? 1 : 0);
  }

  const launchOptions = { headless: true };
  if (fs.existsSync(CHROMIUM_PATH)) launchOptions.executablePath = CHROMIUM_PATH;
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();

  let failed = 0;
  for (const f of targets) {
    const id = f.replace(/\.json$/, "");
    const problems = [];
    let g;
    try {
      g = JSON.parse(fs.readFileSync(path.join(RULES_DIR, f), "utf8"));
    } catch (e) {
      console.log(`FAIL ${id}: invalid JSON (${e.message})`);
      failed++;
      continue;
    }
    problems.push(...validateSchema(g, id));

    if (!problems.length) {
      try {
        const before = await runAxe(page, wrap(g.before, g.doc), id, true);
        if (!before.violations.some((v) => v.id === id)) {
          problems.push(`"before" does not trigger ${id} in axe-core`);
        }
        const afterAll = await runAxe(page, wrap(g.after, g.doc), id, false);
        const leftovers = afterAll.violations.map((v) => v.id);
        if (leftovers.length) problems.push(`"after" still has violations: ${leftovers.join(", ")}`);
      } catch (e) {
        problems.push(`axe run error: ${e.message}`);
      }
    }

    if (problems.length) {
      failed++;
      console.log(`FAIL ${id}`);
      problems.forEach((p) => console.log(`   - ${p}`));
    } else {
      console.log(`ok   ${id}`);
    }
  }

  await browser.close();
  console.log(`\n${targets.length - failed}/${targets.length} guides verified`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
