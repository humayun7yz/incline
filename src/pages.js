// Server-rendered HTML for the public guide pages. Everything that comes from
// guide data goes through esc(), and the pages follow the same accessibility
// rules the scanner checks for (landmarks, skip link, heading order, text
// labels next to colors).

// One stylesheet per font, so a single failed request can't take the others
// down with it. Same fonts as the landing page.
const FONT_LINKS = [
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&display=swap",
  "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;500;600;700&display=swap",
  "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Mono:wght@400;500&display=swap",
]
  .map((href) => `<link href="${href}" rel="stylesheet">`)
  .join("\n");

const LOGO_SVG = `<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
        <rect x="2" y="2" width="26" height="26" rx="8" fill="none" stroke="#4f3fe8" stroke-width="3"/>
        <path d="M8.5 21.5 L21.5 8.5 M13.5 8.5 H21.5 V16.5" fill="none" stroke="#1b2230" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;

const IMPACT_LABEL = { critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor" };

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON inside a <script> tag must not be able to close the tag early.
function jsonLdScript(obj) {
  const json = JSON.stringify(obj).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return `<script type="application/ld+json">${json}</script>`;
}

function layout({ title, description, canonical, current, body, jsonLd }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Incline">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${FONT_LINKS}
<link rel="stylesheet" href="/site.css">
<link rel="stylesheet" href="/guides.css">
${jsonLd ? jsonLdScript(jsonLd) : ""}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <a class="wordmark" href="/" aria-label="Incline, home">
      ${LOGO_SVG}
      Incline
    </a>
    <nav class="nav" aria-label="Main">
      <a class="nav-extra" href="/#how">How it works</a>
      <a class="nav-guides" href="/guides"${current === "guides" ? ' aria-current="page"' : ""}>Fix guides</a>
      <a class="nav-extra" href="/#pricing">Pricing</a>
      <a class="nav-extra" href="/#faq">FAQ</a>
      <a class="btn btn-primary btn-small" href="/#scan">Scan a site</a>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-legal" style="margin-top:0">
      <p>Incline checks pages with axe-core. A clean scan is a strong signal, not a legal guarantee of WCAG compliance, and these guides are general advice, not legal advice.</p>
    </div>
  </div>
</footer>
</body>
</html>`;
}

function impactChip(g) {
  return `<li class="chip impact impact-${esc(g.typicalImpact)}">${esc(IMPACT_LABEL[g.typicalImpact] || g.typicalImpact)} impact</li>`;
}

function wcagChips(g) {
  const chips = [];
  const { criteria, level, bestPractice, wcagVersion } = g.wcag;
  for (const c of criteria) {
    chips.push(`<li class="chip">WCAG ${esc(c.number)}${c.name ? " " + esc(c.name) : ""}</li>`);
  }
  if (level) chips.push(`<li class="chip">Level ${esc(level)}${wcagVersion ? ", WCAG " + esc(wcagVersion) : ""}</li>`);
  if (bestPractice) chips.push(`<li class="chip">Best practice</li>`);
  return chips.join("\n    ");
}

function codeBlock(caption, cls, code) {
  return `<figure>
    <figcaption class="${cls}">${esc(caption)}</figcaption>
    <pre tabindex="0"><code>${esc(code)}</code></pre>
  </figure>`;
}

function guidePage(g, siteUrl) {
  const url = `${siteUrl}/guides/${encodeURIComponent(g.id)}`;
  const description = g.summary;

  const platform = (g.platformNotes || []).length
    ? `<h2>If you use a site builder</h2>
${g.platformNotes
  .map((p) => `<div class="platform"><h3>${esc(p.platform)}</h3><p>${esc(p.note)}</p></div>`)
  .join("\n")}`
    : "";

  const related = g.relatedGuides.length
    ? `<h2>Related guides</h2>
<ul class="related">
${g.relatedGuides.map((r) => `  <li><a href="/guides/${encodeURIComponent(r.id)}">${esc(r.title)}</a></li>`).join("\n")}
</ul>`
    : "";

  const body = `<nav class="crumbs" aria-label="Breadcrumb">
  <ol>
    <li><a href="/guides">Fix guides</a></li>
    <li><a href="/guides#${esc(slug(g.wcag.category))}">${esc(g.wcag.category)}</a></li>
    <li aria-current="page">${esc(g.id)}</li>
  </ol>
</nav>
<article>
  <h1>${esc(g.title)}</h1>
  <p class="lead">${esc(g.summary)}</p>
  <ul class="meta" aria-label="Details">
    ${impactChip(g)}
    ${wcagChips(g)}
    <li class="chip">axe rule: ${esc(g.id)}</li>
  </ul>

  <h2>What is wrong</h2>
  <p>${esc(g.problem)}</p>

  <h2>Who it affects</h2>
  <p>${esc(g.whoItAffects)}</p>

  <h2>Why it matters</h2>
  <p>${esc(g.whyItMatters)}</p>

  <h2>How to fix it</h2>
  <ol class="steps">
${g.steps.map((s) => `    <li>${esc(s)}</li>`).join("\n")}
  </ol>

  <h2>Before and after</h2>
  <div class="compare">
  ${codeBlock("Before: fails the check", "bad", g.before)}
  ${codeBlock("After: passes the check", "good", g.after)}
  </div>

  ${platform}

  <h2>How to check your fix</h2>
  <p>${esc(g.howToCheck)}</p>

  ${related}
</article>

<aside class="cta" aria-labelledby="cta-title">
  <h2 id="cta-title">Does your site have this problem?</h2>
  <p>Paste a page address and Incline scans it in a real browser, then explains every issue it finds in plain English.</p>
  <a class="btn btn-primary" href="/#scan">Scan your site free</a>
</aside>`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        headline: g.title,
        description,
        url,
        mainEntityOfPage: url,
        inLanguage: "en",
        publisher: { "@type": "Organization", name: "Incline", url: siteUrl },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Fix guides", item: `${siteUrl}/guides` },
          { "@type": "ListItem", position: 2, name: g.title, item: url },
        ],
      },
    ],
  };

  return layout({
    title: `${g.title} | Incline`,
    description,
    canonical: url,
    current: "guides",
    body,
    jsonLd,
  });
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function indexPage(index, siteUrl) {
  const url = `${siteUrl}/guides`;
  const total = index.all.length;
  const description = `${total} plain-English accessibility fix guides, each with the problem, who it affects, step-by-step fixes and tested before and after code.`;

  const jump = index.categories
    .map((c) => `<li><a href="#${esc(slug(c.name))}">${esc(c.name)} (${c.guides.length})</a></li>`)
    .join("\n    ");

  const sections = index.categories
    .map(
      (c) => `<section aria-labelledby="${esc(slug(c.name))}">
  <h2 id="${esc(slug(c.name))}">${esc(c.name)}</h2>
  <ul class="guide-list">
${c.guides
  .map(
    (g) => `    <li>
      <a href="/guides/${encodeURIComponent(g.id)}">${esc(g.title)}</a><span class="chip impact impact-${esc(g.typicalImpact)}">${esc(IMPACT_LABEL[g.typicalImpact] || g.typicalImpact)}</span>
      <p>${esc(g.summary)}</p>
    </li>`
  )
  .join("\n")}
  </ul>
</section>`
    )
    .join("\n");

  const body = `<h1>Accessibility fix guides</h1>
<p class="lead index-intro">${total} common accessibility problems, explained in plain English. Each guide shows who is affected, how to fix it step by step, and code that has been tested against the same engine Incline uses.</p>
<nav aria-label="Categories">
  <ul class="jump">
    ${jump}
  </ul>
</nav>
${sections}
<aside class="cta" aria-labelledby="cta-title">
  <h2 id="cta-title">Not sure which of these your site has?</h2>
  <p>Paste a page address and Incline finds the real problems on it, then links each one to a fix.</p>
  <a class="btn btn-primary" href="/#scan">Scan your site free</a>
</aside>`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Accessibility fix guides",
    description,
    url,
    inLanguage: "en",
    publisher: { "@type": "Organization", name: "Incline", url: siteUrl },
  };

  return layout({
    title: "Accessibility fix guides | Incline",
    description,
    canonical: url,
    current: "guides",
    body,
    jsonLd,
  });
}

function notFoundPage(siteUrl) {
  const body = `<h1>We couldn't find that guide</h1>
<p class="lead">It may have moved, or the address may have a typo.</p>
<p><a class="btn btn-primary" href="/guides">Browse all fix guides</a></p>`;
  return layout({
    title: "Guide not found | Incline",
    description: "That guide could not be found.",
    canonical: `${siteUrl}/guides`,
    current: "guides",
    body,
  });
}

module.exports = { guidePage, indexPage, notFoundPage, esc, slug };
