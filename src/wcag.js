// Turns axe-core's rule metadata (tags like "wcag111", "wcag2a", "cat.forms",
// "section508") into the labels shown on the fix-guide pages. We derive the
// WCAG criterion and level from axe's own tags rather than writing them by
// hand, so a guide can never disagree with what the scanner reports.

const SC_NAMES = {
  "1.1.1": "Non-text Content",
  "1.2.1": "Audio-only and Video-only (Prerecorded)",
  "1.2.2": "Captions (Prerecorded)",
  "1.3.1": "Info and Relationships",
  "1.3.4": "Orientation",
  "1.3.5": "Identify Input Purpose",
  "1.4.1": "Use of Color",
  "1.4.2": "Audio Control",
  "1.4.3": "Contrast (Minimum)",
  "1.4.4": "Resize Text",
  "1.4.12": "Text Spacing",
  "2.1.1": "Keyboard",
  "2.1.3": "Keyboard (No Exception)",
  "2.2.1": "Timing Adjustable",
  "2.2.2": "Pause, Stop, Hide",
  "2.4.1": "Bypass Blocks",
  "2.4.2": "Page Titled",
  "2.4.4": "Link Purpose (In Context)",
  "2.5.3": "Label in Name",
  "2.5.8": "Target Size (Minimum)",
  "3.1.1": "Language of Page",
  "3.1.2": "Language of Parts",
  "3.3.2": "Labels or Instructions",
  "4.1.1": "Parsing",
  "4.1.2": "Name, Role, Value",
};

const CATEGORY_LABELS = {
  "cat.text-alternatives": "Images and text alternatives",
  "cat.name-role-value": "Names, roles and values",
  "cat.aria": "ARIA",
  "cat.color": "Color and contrast",
  "cat.forms": "Forms",
  "cat.keyboard": "Keyboard and focus",
  "cat.language": "Language",
  "cat.semantics": "Page structure",
  "cat.structure": "Page structure",
  "cat.tables": "Tables",
  "cat.time-and-media": "Media and timing",
  "cat.parsing": "Markup",
  "cat.sensory-and-visual-cues": "Zoom and sizing",
};

// Display order of categories on the index page.
const CATEGORY_ORDER = [
  "Images and text alternatives",
  "Color and contrast",
  "Forms",
  "Names, roles and values",
  "Keyboard and focus",
  "Page structure",
  "ARIA",
  "Tables",
  "Language",
  "Media and timing",
  "Zoom and sizing",
  "Markup",
];

/** "wcag111" -> "1.1.1", "wcag1412" -> "1.4.12". Returns null for non-SC tags. */
function scFromTag(tag) {
  const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

/**
 * @param {string[]} tags axe rule tags
 * @returns {{criteria: {number:string,name:string}[], level: "A"|"AA"|"AAA"|null,
 *   wcagVersion: string|null, bestPractice: boolean, standards: string[], category: string}}
 */
function describeTags(tags) {
  const criteria = [];
  for (const t of tags) {
    const sc = scFromTag(t);
    if (sc) criteria.push({ number: sc, name: SC_NAMES[sc] || "" });
  }

  // Level and the WCAG version it first appeared in, from tags such as
  // wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa. "-obsolete" variants are ignored.
  let level = null;
  let wcagVersion = null;
  for (const t of tags) {
    const m = /^wcag(2|21|22)(a|aa|aaa)$/.exec(t);
    if (!m) continue;
    const lv = m[2].toUpperCase();
    const order = { A: 1, AA: 2, AAA: 3 };
    if (!level || order[lv] > order[level]) level = lv;
    wcagVersion = m[1] === "2" ? "2.0" : m[1] === "21" ? "2.1" : "2.2";
  }

  const standards = [];
  if (tags.includes("section508")) standards.push("Section 508");
  if (tags.includes("EN-301-549")) standards.push("EN 301 549");

  const catTag = tags.find((t) => t.startsWith("cat."));
  const category = CATEGORY_LABELS[catTag] || "Other";

  return {
    criteria,
    level,
    wcagVersion,
    bestPractice: tags.includes("best-practice"),
    standards,
    category,
  };
}

module.exports = { describeTags, scFromTag, SC_NAMES, CATEGORY_ORDER, CATEGORY_LABELS };
