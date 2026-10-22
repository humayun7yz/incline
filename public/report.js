// Draws a scan report. Shared by the scanner on the home page and the saved
// reports on the account page, so both look and behave the same. Everything
// that comes from the server is escaped before it is written into the page.

(function () {
  "use strict";

  var SEVERITY_ORDER = ["critical", "serious", "moderate", "minor"];
  var IMPACT_LABEL = { critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor" };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function tally(violations) {
    var counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    violations.forEach(function (v) {
      counts[SEVERITY_ORDER.indexOf(v.impact) > -1 ? v.impact : "minor"]++;
    });
    var items = SEVERITY_ORDER.filter(function (k) {
      return counts[k] > 0;
    })
      .map(function (k) {
        return (
          '<span class="tally-item ' + k + '"><span class="tally-dot" aria-hidden="true"></span>' +
          counts[k] + " " + IMPACT_LABEL[k] + "</span>"
        );
      })
      .join("");
    return '<div class="tally">' + items + "</div>";
  }

  /**
   * @param {object} data   a scan result from /api/scan or /api/reports/:id
   * @param {object} [opts] { note: html string shown under the report heading }
   * @returns {string} HTML for the report
   */
  function renderReport(data, opts) {
    opts = opts || {};
    var parts = [];
    parts.push('<section class="report" aria-label="Scan report">');

    parts.push('<div class="report-head"><div>');
    parts.push('<h2 class="site-title">' + escapeHtml(data.title || "Scan result") + "</h2>");
    parts.push('<p class="site-url">' + escapeHtml(data.url) + "</p></div>");
    parts.push('<div class="report-actions">');
    if (data.violationCount === 0) {
      parts.push('<span class="pill-clean">All clear: 0 issues found</span>');
    } else {
      parts.push(tally(data.violations));
      parts.push('<button class="btn btn-quiet btn-small" data-action="print" type="button">Print report</button>');
    }
    parts.push("</div></div>");

    if (opts.note) parts.push('<div class="report-note">' + opts.note + "</div>");

    if (!data.aiAvailable && data.violationCount > 0) {
      parts.push(
        '<div class="ai-note">The plain-English explanations are switched off on this server, so these are the raw axe-core findings.</div>'
      );
    }

    data.violations.forEach(function (v) {
      var sev = SEVERITY_ORDER.indexOf(v.impact) > -1 ? v.impact : "minor";
      parts.push('<article class="finding"><div class="finding-body">');
      parts.push('<div class="finding-title-row">');
      parts.push('<h3 class="finding-title">' + escapeHtml(v.help) + "</h3>");
      parts.push('<span class="sev-badge ' + sev + '">' + IMPACT_LABEL[sev] + "</span></div>");

      if (v.explain) parts.push('<p class="finding-explain">' + escapeHtml(v.explain) + "</p>");

      if (v.steps && v.steps.length) {
        parts.push('<div class="finding-section"><p class="section-label">How to fix it</p><ol class="fix-steps">');
        v.steps.forEach(function (s) {
          parts.push("<li>" + escapeHtml(s) + "</li>");
        });
        parts.push("</ol></div>");
      }

      var code = v.fix || v.exampleHtml;
      if (code) {
        parts.push(
          '<div class="finding-section"><p class="section-label">' +
            (v.fix ? "Suggested fix" : "Markup on your page") +
            '</p><pre class="fix" tabindex="0"><code>' +
            escapeHtml(code) +
            "</code></pre></div>"
        );
      }

      if (v.risk) {
        parts.push(
          '<div class="finding-section"><p class="section-label">Why it matters for your business</p><p class="risk-note">' +
            escapeHtml(v.risk) +
            "</p></div>"
        );
      }
      if (v.also) parts.push('<div class="finding-section"><p class="also-note">' + escapeHtml(v.also) + "</p></div>");

      // Only same-site guide paths are linked, whatever the server sends.
      var guideLink =
        typeof v.guideUrl === "string" && /^\/guides\/[a-z0-9-]+$/.test(v.guideUrl)
          ? ' &middot; <a href="' + v.guideUrl + '" target="_blank" rel="noopener">Full fix guide<span class="visually-hidden"> (opens in a new tab)</span></a>'
          : "";
      parts.push(
        '<p class="finding-meta">Found on ' + v.nodeCount + " element" + (v.nodeCount === 1 ? "" : "s") +
          guideLink +
          ' &middot; <a href="' + escapeHtml(v.helpUrl) +
          '" target="_blank" rel="noopener">WCAG reference<span class="visually-hidden"> (opens in a new tab)</span></a></p>'
      );
      parts.push("</div></article>");
    });

    parts.push("</section>");
    return parts.join("");
  }

  /** Makes the report's Print button work once its HTML is on the page. */
  function wireReport(container) {
    var btn = container.querySelector('[data-action="print"]');
    if (btn) btn.addEventListener("click", function () { window.print(); });
  }

  window.InclineReport = { escapeHtml: escapeHtml, renderReport: renderReport, wireReport: wireReport };
})();
