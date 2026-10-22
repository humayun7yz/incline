// Log in, sign up and the saved-reports page. Which one runs depends on which
// form or area is on the page. Everything shown from the server is escaped.

(function () {
  "use strict";

  var IR = window.InclineReport;
  var esc = IR.escapeHtml;

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
    });
  }

  function setError(message) {
    var el = document.getElementById("formError");
    if (el) el.textContent = message || "";
  }

  var NETWORK_ERROR = "We couldn't reach the server. Check your connection and try again.";

  function showDisabled() {
    var msg = document.getElementById("disabledMsg");
    if (msg) msg.hidden = false;
    ["loginForm", "signupForm", "accountArea", "altLink"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = true;
    });
  }

  // ---------- log in and sign up ----------

  function wireAuthForm(formId, endpoint, fallbackError) {
    var form = document.getElementById(formId);
    if (!form) return;
    var btn = document.getElementById("submitBtn");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = form.elements.email.value.trim();
      var password = form.elements.password.value;
      setError("");
      if (!email || !password) {
        setError(!email ? "Enter your email address." : "Enter your password.");
        (email ? form.elements.password : form.elements.email).focus();
        return;
      }
      btn.disabled = true;
      api("POST", endpoint, { email: email, password: password })
        .then(function (r) {
          if (r.ok) {
            window.location.href = "/account";
            return;
          }
          setError(r.data.error || fallbackError);
          btn.disabled = false;
        })
        .catch(function () {
          setError(NETWORK_ERROR);
          btn.disabled = false;
        });
    });
  }

  wireAuthForm("loginForm", "/api/auth/login", "We couldn't log you in. Please try again.");
  wireAuthForm("signupForm", "/api/auth/signup", "We couldn't create your account. Please try again.");

  // ---------- saved reports ----------

  var area = document.getElementById("accountArea");
  var listArea = document.getElementById("listArea");
  var viewer = document.getElementById("viewer");

  function formatDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function renderList(payload) {
    var reports = payload.reports || [];
    if (!reports.length) {
      listArea.innerHTML =
        '<div class="empty-state"><h2>No saved reports yet</h2>' +
        "<p>Scan a page while you're logged in and the report is saved here automatically.</p>" +
        '<a class="btn btn-primary" href="/#scan">Scan a site</a></div>';
      return;
    }
    var items = reports
      .map(function (r) {
        var count = r.violation_count;
        var issues = count === 0 ? "No issues" : count + (count === 1 ? " issue" : " issues");
        return (
          '<li class="saved-item" data-id="' + esc(r.id) + '"><div>' +
          '<p class="saved-title">' + esc(r.title || r.url) + "</p>" +
          '<p class="saved-meta">' + esc(r.url) + " &middot; " + esc(formatDate(r.created_at)) + " &middot; " + esc(issues) + "</p>" +
          '</div><div class="saved-actions">' +
          '<button class="btn btn-quiet btn-small" type="button" data-action="view">View<span class="visually-hidden"> report for ' + esc(r.title || r.url) + "</span></button>" +
          '<button class="btn btn-quiet btn-small" type="button" data-action="delete">Delete<span class="visually-hidden"> report for ' + esc(r.title || r.url) + "</span></button>" +
          "</div></li>"
        );
      })
      .join("");
    listArea.innerHTML =
      '<p class="saved-meta" style="margin:0 0 14px">Your plan keeps your last ' + esc(payload.limit) + " reports. Older ones are removed automatically.</p>" +
      '<ul class="saved-list">' + items + "</ul>";
  }

  function loadList() {
    return api("GET", "/api/reports").then(function (r) {
      if (r.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!r.ok) {
        setError(r.data.error || "We couldn't load your reports. Please try again.");
        return;
      }
      setError("");
      renderList(r.data);
    });
  }

  function viewReport(id) {
    api("GET", "/api/reports/" + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) {
        setError(r.data.error || "We couldn't open that report.");
        return;
      }
      setError("");
      viewer.innerHTML = IR.renderReport(r.data, {
        note: '<button class="btn btn-quiet btn-small" type="button" data-action="close">Close report</button>',
      });
      IR.wireReport(viewer);
      viewer.focus();
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      viewer.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
  }

  function deleteReport(id, btn) {
    // Two clicks: the first asks, the second deletes.
    if (btn.dataset.confirm !== "1") {
      btn.dataset.confirm = "1";
      var original = btn.innerHTML;
      btn.textContent = "Click again to delete";
      setTimeout(function () {
        if (btn.isConnected && btn.dataset.confirm === "1") {
          btn.dataset.confirm = "";
          btn.innerHTML = original;
        }
      }, 4000);
      return;
    }
    btn.disabled = true;
    api("DELETE", "/api/reports/" + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) {
        setError(r.data.error || "We couldn't delete that report.");
        btn.disabled = false;
        return;
      }
      viewer.innerHTML = "";
      loadList();
    });
  }

  if (area) {
    area.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]");
      if (!btn) return;
      var action = btn.getAttribute("data-action");
      if (action === "close") {
        viewer.innerHTML = "";
        return;
      }
      var item = btn.closest(".saved-item");
      if (!item) return;
      if (action === "view") viewReport(item.getAttribute("data-id"));
      if (action === "delete") deleteReport(item.getAttribute("data-id"), btn);
    });

    var logout = document.getElementById("logoutBtn");
    if (logout) {
      logout.addEventListener("click", function () {
        logout.disabled = true;
        api("POST", "/api/auth/logout").then(function () {
          window.location.href = "/";
        });
      });
    }
  }

  // ---------- decide what to show once we know who is signed in ----------

  window.inclineAuthReady.then(function (state) {
    var onAuthPage = document.getElementById("loginForm") || document.getElementById("signupForm");
    if (!state.accountsEnabled) return showDisabled();
    if (onAuthPage && state.user) return window.location.replace("/account");
    if (area) {
      if (!state.user) return window.location.replace("/login");
      document.getElementById("whoEmail").textContent = state.user.email;
      document.getElementById("planTag").textContent = state.user.plan.charAt(0).toUpperCase() + state.user.plan.slice(1) + " plan";
      area.hidden = false;
      loadList();
    }
  });
})();
