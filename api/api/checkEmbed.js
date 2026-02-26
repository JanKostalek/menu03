import dns from "dns/promises";
import net from "net";

function isPrivateIp(ip) {
  // IPv4
  if (net.isIP(ip) === 4) {
    const parts = ip.split(".").map(n => parseInt(n, 10));
    const [a, b] = parts;

    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }

  // IPv6 (základní bloky)
  if (net.isIP(ip) === 6) {
    const low = ip.toLowerCase();
    if (low === "::1") return true;                 // loopback
    if (low.startsWith("fe80:")) return true;       // link-local
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // unique local
    return false;
  }

  return true;
}

function normalizeHeaderValue(v) {
  if (!v) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function parseCspFrameAncestors(csp) {
  // hledáme pouze frame-ancestors directive (pokud existuje)
  const s = String(csp || "");
  const parts = s.split(";").map(x => x.trim()).filter(Boolean);
  for (const p of parts) {
    if (p.toLowerCase().startsWith("frame-ancestors")) return p;
  }
  return "";
}

function isEmbeddableFromHeaders(headers) {
  const xfo = normalizeHeaderValue(headers.get?.("x-frame-options") || headers["x-frame-options"]);
  const csp = normalizeHeaderValue(headers.get?.("content-security-policy") || headers["content-security-policy"]);

  // X-Frame-Options: DENY / SAMEORIGIN => blok
  const xfoUp = xfo.toUpperCase();
  if (xfoUp.includes("DENY")) return { ok: false, reason: "X-Frame-Options: DENY" };
  if (xfoUp.includes("SAMEORIGIN")) return { ok: false, reason: "X-Frame-Options: SAMEORIGIN" };

  // CSP frame-ancestors, pokud existuje
  const fa = parseCspFrameAncestors(csp);
  if (fa) {
    const faLow = fa.toLowerCase();

    // frame-ancestors 'none' => blok
    if (faLow.includes("'none'")) return { ok: false, reason: "CSP frame-ancestors 'none'" };

    // frame-ancestors 'self' => blok (my nejsme self)
    // Pozn.: Teoreticky by mohl být i whitelist, ale bez znalosti našeho originu to bereme jako riziko.
    if (faLow.includes("'self'")) return { ok: false, reason: "CSP frame-ancestors 'self'" };

    // pokud je tam explicitní whitelist, nemusí to být blok, ale neumíme bezpečně rozhodnout
    // => necháme jako "nejisté", ale povolíme pokus o embed
    return { ok: true, reason: "CSP frame-ancestors present (uncertain)" };
  }

  // žádné blokující hlavičky nenalezeny
  return { ok: true, reason: "No XFO/CSP block detected" };
}

export default async function handler(req, res) {
  try {
    const urlRaw = req.query?.url;
    if (!urlRaw) {
      res.status(400).json({ embeddable: false, reason: "Missing url" });
      return;
    }

    let u;
    try {
      u = new URL(String(urlRaw));
    } catch {
      res.status(400).json({ embeddable: false, reason: "Invalid URL" });
      return;
    }

    if (!["http:", "https:"].includes(u.protocol)) {
      res.status(400).json({ embeddable: false, reason: "Only http/https allowed" });
      return;
    }

    // DNS lookup + blokace privátních IP (SSRF ochrana)
    const host = u.hostname;
    const lookup = await dns.lookup(host, { all: true });
    for (const rec of lookup) {
      if (isPrivateIp(rec.address)) {
        res.status(400).json({ embeddable: false, reason: "Blocked host (private network)" });
        return;
      }
    }

    // HEAD je rychlejší, ale někteří to neumí -> fallback na GET s minimálním přenosem
    let r;
    try {
      r = await fetch(u.toString(), { method: "HEAD", redirect: "follow" });
    } catch {
      r = null;
    }

    if (!r || !r.ok) {
      // fallback GET, ale chceme co nejméně dat
      const rg = await fetch(u.toString(), { method: "GET", redirect: "follow" });
      const verdict = isEmbeddableFromHeaders(rg.headers);
      res.status(200).json({ embeddable: verdict.ok, reason: verdict.reason });
      return;
    }

    const verdict = isEmbeddableFromHeaders(r.headers);
    res.status(200).json({ embeddable: verdict.ok, reason: verdict.reason });
  } catch (e) {
    res.status(200).json({ embeddable: true, reason: "Check failed, allow embed attempt" });
  }
}