// Scan form, report rendering and waitlist form for the landing page.
// Everything that comes back from the server is escaped before it is
// written into the page.

(function () {
  "use strict";

  var form = document.getElementById("scanForm");
  var urlInput = document.getElementById("urlInput");
  var scanBtn = document.getElementById("scanBtn");
  var output = document.getElementById("output");
  var live = document.getElementById("liveStatus");

  var SEVERITY_ORDER = ["critical", "serious", "moderate", "minor"];
  var IMPACT_LABEL = { critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor" };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function say(text) {
    if (live) live.textContent = text;
  }

  function showOutput() {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    output.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  if (form) {
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var url = urlInput.value.trim();
      if (!url) return;
      scanBtn.disabled = true;
      say("Scanning " + url + ". This takes 10 to 20 seconds.");
      output.innerHTML =
        '<div class="status"><span class="spinner" aria-hidden="true"></span>Scanning ' +
        escapeHtml(url) +
        "&hellip;</div>";
      showOutput();

      try {
        var res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url }),
        });
        var data = await res.json();
        if (!res.ok) {
          var msg = data.error || "The scan failed.";
          output.innerHTML = '<div class="error">' + escapeHtml(msg) + "</div>";
          say(msg);
          return;
        }
        render(data);
        say(
          data.violationCount === 0
            ? "Scan finished. No issues found."
            : "Scan finished. " + data.violationCount + (data.violationCount === 1 ? " issue" : " issues") + " found."
        );
        showOutput();
      } catch (err) {
        var netMsg = "We couldn't reach the server. Check your connection and try again.";
        output.innerHTML = '<div class="error">' + escapeHtml(netMsg) + "</div>";
        say(netMsg);
      } finally {
        scanBtn.disabled = false;
      }
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

  function render(data) {
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
      parts.push('<button class="btn btn-quiet btn-small" id="printBtn" type="button">Print report</button>');
    }
    parts.push("</div></div>");

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
    output.innerHTML = parts.join("");

    var printBtn = document.getElementById("printBtn");
    if (printBtn) printBtn.addEventListener("click", function () { window.print(); });
  }

  // ---------- waitlist ----------

  var wl = document.getElementById("waitlistForm");
  if (wl) {
    var wlEmail = document.getElementById("wlEmail");
    var wlBtn = document.getElementById("wlBtn");
    var wlMsg = document.getElementById("wlMsg");

    wl.addEventListener("submit", async function (e) {
      e.preventDefault();
      var email = wlEmail.value.trim();
      if (!email) return;
      wlBtn.disabled = true;
      wlMsg.className = "wl-msg";
      wlMsg.textContent = "Adding you to the list…";
      try {
        var hp = wl.querySelector('[name="website"]');
        var res = await fetch("/api/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email, website: hp ? hp.value : "" }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          wlMsg.className = "wl-msg is-error";
          wlMsg.textContent = data.error || "Something went wrong. Please try again.";
        } else {
          wlMsg.textContent = "You're on the list. We'll email you when the plans open.";
          wl.reset();
        }
      } catch (err) {
        wlMsg.className = "wl-msg is-error";
        wlMsg.textContent = "We couldn't reach the server. Check your connection and try again.";
      } finally {
        wlBtn.disabled = false;
      }
    });
  }
})();
