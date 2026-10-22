// Scan form and waitlist form for the landing page. Reports are drawn by
// report.js; the header sign-in link and auth state come from nav.js.

(function () {
  "use strict";

  var IR = window.InclineReport;
  var escapeHtml = IR.escapeHtml;

  var form = document.getElementById("scanForm");
  var urlInput = document.getElementById("urlInput");
  var scanBtn = document.getElementById("scanBtn");
  var output = document.getElementById("output");
  var live = document.getElementById("liveStatus");

  // Filled in by nav.js once it knows whether accounts are on and who is signed in.
  var auth = { accountsEnabled: false, user: null };
  if (window.inclineAuthReady) {
    window.inclineAuthReady.then(function (state) {
      auth = state;
    });
  }

  function say(text) {
    if (live) live.textContent = text;
  }

  function showOutput() {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    output.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  // The line under the report heading: saved, or an invitation to sign up.
  function reportNote(data) {
    if (data.saved === true) {
      return 'Saved to your account. <a href="/account">See your saved reports</a>';
    }
    if (data.saved === false) {
      return "We couldn't save this report to your account, but your results are below.";
    }
    if (auth.accountsEnabled && !auth.user) {
      return '<a href="/signup">Create a free account</a> to save your reports, or <a href="/login">log in</a>.';
    }
    return "";
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
          credentials: "same-origin",
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
        output.innerHTML = IR.renderReport(data, { note: reportNote(data) });
        IR.wireReport(output);
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
