// Cost and abuse protection for the public scan endpoint. Every scan uses
// browser memory and (when configured) paid AI calls, so we cap how often one
// visitor can scan and how many scans run at the same time.
//
// This is in-memory, which is fine for a single Render instance. If the app
// ever runs on more than one instance, move the counters to a shared store.

function intFromEnv(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Fixed-window limiter keyed by client IP.
 * Responds 429 with a Retry-After header when the limit is hit.
 */
function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) if (entry.resetAt <= now) hits.delete(ip);
  }, 60 * 1000);
  sweep.unref();

  return function limiter(req, res, next) {
    const ip = req.ip || "unknown";
    const now = Date.now();
    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

/**
 * Caps how many scans run at once. Extra requests get a 503 right away
 * instead of queueing and piling up browsers in memory.
 */
function concurrencyGate(maxConcurrent) {
  let running = 0;
  return function gate(req, res, next) {
    if (running >= maxConcurrent) {
      res.set("Retry-After", "15");
      return res
        .status(503)
        .json({ error: "We're busy scanning other sites right now. Please try again in a few seconds." });
    }
    running += 1;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        running -= 1;
      }
    };
    res.on("finish", release);
    res.on("close", release);
    next();
  };
}

const scanLimits = [
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: intFromEnv("SCAN_LIMIT_PER_10_MIN", 5),
    message: "You've reached the scan limit for now. Please wait a few minutes and try again.",
  }),
  rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: intFromEnv("SCAN_LIMIT_PER_DAY", 30),
    message: "You've reached today's free scan limit. Please come back tomorrow.",
  }),
  concurrencyGate(intFromEnv("MAX_CONCURRENT_SCANS", 2)),
];

module.exports = { scanLimits, rateLimit, concurrencyGate };
