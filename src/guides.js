// Loads the fix guides in content/rules/*.json once at startup and attaches
// the WCAG labels that axe-core itself reports for each rule (level,
// criteria, category), so a published guide can never disagree with the
// scanner. Guides are checked for accuracy by scripts/verify-guides.js; this
// file only reads and organises them.

const fs = require("fs");
const path = require("path");
const axe = require("axe-core");
const { describeTags, CATEGORY_ORDER } = require("./wcag");

const RULES_DIR = path.join(__dirname, "..", "content", "rules");

function loadGuides() {
  const axeRules = new Map(axe.getRules().map((r) => [r.ruleId, r]));
  const guides = [];

  for (const file of fs.readdirSync(RULES_DIR).sort()) {
    if (!file.endsWith(".json")) continue;
    const id = file.replace(/\.json$/, "");
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(RULES_DIR, file), "utf8"));
    } catch (err) {
      console.error(`Skipping guide ${file}: ${err.message}`);
      continue;
    }
    if (data.id !== id) {
      console.error(`Skipping guide ${file}: id "${data.id}" does not match the file name.`);
      continue;
    }
    const rule = axeRules.get(id);
    if (!rule) {
      console.error(`Skipping guide ${id}: this axe-core version has no such rule.`);
      continue;
    }
    guides.push({
      ...data,
      axeDescription: rule.description,
      helpUrl: rule.helpUrl,
      wcag: describeTags(rule.tags),
    });
  }
  return guides;
}

function buildIndex(guides) {
  const byId = new Map(guides.map((g) => [g.id, g]));

  // Only keep related links that point at a guide we actually publish.
  for (const g of guides) {
    g.relatedGuides = (g.related || []).map((rid) => byId.get(rid)).filter(Boolean);
  }

  const byCategory = new Map();
  for (const g of guides) {
    const cat = g.wcag.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(g);
  }
  const categories = [...byCategory.keys()].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });

  const IMPACT_RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  for (const list of byCategory.values()) {
    list.sort((a, b) => IMPACT_RANK[a.typicalImpact] - IMPACT_RANK[b.typicalImpact] || a.title.localeCompare(b.title));
  }

  return {
    all: guides,
    byId,
    categories: categories.map((name) => ({ name, guides: byCategory.get(name) })),
  };
}

module.exports = { loadGuides, buildIndex };
