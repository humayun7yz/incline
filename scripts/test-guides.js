#!/usr/bin/env node
// Structural checks for the public guide pages. Run: node scripts/test-guides.js
//   - every guide renders, with exactly one h1 and a valid JSON-LD block
//   - every internal link points at a page that exists
//   - guide text is escaped, so odd characters can never inject markup

const { loadGuides, buildIndex } = require("../src/guides");
const { guidePage, indexPage, notFoundPage } = require("../src/pages");

const SITE = "https://example.test";
let failures = 0;
function check(ok, label) {
  if (!ok) {
    failures++;
    console.log("FAIL", label);
  }
}

const index = buildIndex(loadGuides());
check(index.all.length >= 79, `expected at least 79 guides, got ${index.all.length}`);
const ids = new Set(index.all.map((g) => g.id));

function inspect(name, html) {
  check((html.match(/<h1[\s>]/g) || []).length === 1, `${name}: needs exactly one h1`);
  check(/<html lang="en">/.test(html), `${name}: missing html lang`);
  check(/<title>[^<]{5,}<\/title>/.test(html), `${name}: missing title`);
  check(/<link rel="canonical" href="https:\/\/example\.test\//.test(html), `${name}: missing canonical`);
  for (const m of html.matchAll(/href="(\/guides\/[^"#]+)"/g)) {
    const id = decodeURIComponent(m[1].replace("/guides/", ""));
    check(ids.has(id), `${name}: broken link ${m[1]}`);
  }
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ld) {
    try {
      JSON.parse(ld[1]);
    } catch {
      check(false, `${name}: invalid JSON-LD`);
    }
  }
}

inspect("index", indexPage(index, SITE));
inspect("404", notFoundPage(SITE));
for (const g of index.all) inspect(g.id, guidePage(g, SITE));

// Hostile content must come out inert.
const evil = '<img src=x onerror=alert(1)>"\'</script><script>alert(2)</script>';
const base = index.all[0];
const hostile = {
  ...base,
  title: evil,
  summary: evil,
  problem: evil,
  whoItAffects: evil,
  whyItMatters: evil,
  howToCheck: evil,
  steps: [evil, evil, evil],
  before: evil,
  after: evil,
  platformNotes: [{ platform: evil, note: evil }],
  relatedGuides: [],
};
const html = guidePage(hostile, SITE);
check(!html.includes("<img src=x"), "hostile: raw <img> tag leaked through");
check(!html.includes("<script>alert(2)"), "hostile: raw <script> leaked through");
check((html.match(/<script(?![^>]*\ssrc=)/g) || []).length === 1, "hostile: unexpected inline script tag (only JSON-LD allowed)");
const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
check(!/<\/script/i.test(ld), "hostile: JSON-LD could close its own script tag");

console.log(failures ? `${failures} check(s) FAILED` : `ALL PASSED (${index.all.length} guides + index + 404 + hostile-input test)`);
process.exit(failures ? 1 : 0);
