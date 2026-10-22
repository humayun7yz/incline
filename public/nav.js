// Shows "Log in" or "Account" in the header, and tells other scripts whether
// accounts are switched on and who is signed in. If accounts are off (no
// database yet) or the request fails, the header is left exactly as it is.

(function () {
  "use strict";

  window.inclineAuthReady = fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (res) {
      return res.ok ? res.json() : { accountsEnabled: false, user: null };
    })
    .catch(function () {
      return { accountsEnabled: false, user: null };
    })
    .then(function (state) {
      window.inclineAuth = state;
      if (state.accountsEnabled) addNavLink(state.user);
      return state;
    });

  function addNavLink(user) {
    var nav = document.querySelector(".site-header .nav");
    if (!nav) return;
    var a = document.createElement("a");
    a.className = "nav-account";
    a.href = user ? "/account" : "/login";
    a.textContent = user ? "Account" : "Log in";
    var cta = nav.querySelector(".btn");
    nav.insertBefore(a, cta || null);
  }
})();
