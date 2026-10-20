const { assertPublicUrl } = require("../src/urlsafety");
const cases = [
  ["http://localhost/", false],
  ["http://127.0.0.1/", false],
  ["http://2130706433/", false],
  ["http://0x7f.1/", false],
  ["http://[::1]/", false],
  ["http://[::ffff:127.0.0.1]/", false],
  ["http://[::ffff:7f00:1]/", false],
  ["http://169.254.169.254/latest/meta-data/", false],
  ["http://10.0.0.5/", false],
  ["http://192.168.1.1/", false],
  ["http://172.16.0.1/", false],
  ["http://100.64.0.1/", false],
  ["http://[fd00::1]/", false],
  ["http://[fe80::1]/", false],
  ["https://example.com:8080/", false],
  ["https://user:pw@example.com/", false],
  ["file:///etc/passwd", false],
  ["javascript:alert(1)", false],
  ["not a url", false],
  ["http://8.8.8.8/", true],
];
(async () => {
  let bad = 0;
  for (const [u, ok] of cases) {
    let got, msg = "";
    try { await assertPublicUrl(u); got = true; } catch (e) { got = false; msg = e.message; }
    const pass = got === ok;
    if (!pass) bad++;
    console.log(pass ? "PASS" : "FAIL", ok ? "allow" : "block", u, got ? "" : "-> " + msg);
  }
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
