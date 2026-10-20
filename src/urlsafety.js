// Guards the scanner against SSRF: a public "scan any URL" endpoint can
// otherwise be pointed at localhost, the host's private network or a cloud
// metadata service (169.254.169.254) and used to read things only the
// server can reach. We only allow http(s) on the standard web ports, and
// only when the hostname resolves to public addresses.

const dns = require("dns").promises;
const net = require("net");

const ALLOWED_PORTS = new Set(["", "80", "443"]);

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

// [network, prefix length] pairs for IPv4 ranges that are not public.
const BLOCKED_V4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, includes cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
].map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  // Bitwise & yields a signed 32-bit number; >>> 0 makes it unsigned so it
  // compares correctly against addresses at or above 128.0.0.0.
  return { base: (ipv4ToInt(base) & mask) >>> 0, mask };
});

function isBlockedV4(ip) {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(({ base, mask }) => ((n & mask) >>> 0) === base);
}

function isBlockedV6(ip) {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  // IPv4-mapped (::ffff:1.2.3.4 or ::ffff:7f00:1): judge by the IPv4 part.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isBlockedV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(lower.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

function isBlockedIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true; // not an IP at all: refuse
}

/**
 * Throws an Error with a user-safe message if the URL must not be fetched.
 * Returns the parsed URL when it is fine.
 */
async function assertPublicUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error("Please provide a valid http(s) URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Please provide a valid http(s) URL.");
  }
  if (u.username || u.password) {
    throw new Error("URLs with a username or password are not allowed.");
  }
  if (!ALLOWED_PORTS.has(u.port)) {
    throw new Error("Only the standard web ports (80 and 443) can be scanned.");
  }

  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("That address is not a public website.");
  }

  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error("That address is not a public website.");
    return u;
  }

  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("We couldn't find that website. Check the address and try again.");
  }
  if (!addresses.length || addresses.some((a) => isBlockedIp(a.address))) {
    throw new Error("That address is not a public website.");
  }
  return u;
}

module.exports = { assertPublicUrl, isBlockedIp };
