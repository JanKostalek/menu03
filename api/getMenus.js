import { kv } from "@vercel/kv";
import { load as loadHtml } from "cheerio";
import fs from "fs";
import path from "path";

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isPdf(url) {
  return /\.pdf(\?|#|$)/i.test(url || "");
}

function isImage(url) {
  return /\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(url || "");
}

function cleanText(s) {
  return String(s || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeMode(mode) {
  const m = String(mode || "").trim().toLowerCase();
  return (m === "embed" || m === "parse") ? m : "parse";
}

/**
 * Heuristický parser – základní (není 100%)
 */
function extractMealsHeuristic(html) {
  const $ = loadHtml(html);
  $("script, style, noscript").remove();
  $("nav, header, footer").remove();

  let root = $("main");
  if (!root || root.length === 0) root = $("#content");
  if (!root || root.length === 0) root = $("body");

  const PRICE_RE = /\b(\d{2,4})\s*(Kč|CZK)\b/i;
  const candidates = [];

  root.find("*").each((_, el) => {
    const text = cleanText($(el).text());
    if (!text) return;
    if (!PRICE_RE.test(text)) return;
    if (text.length > 220) return;

    const priceMatch = text.match(PRICE_RE);
    const price = priceMatch ? priceMatch[1] : null;

    let name = cleanText(text.replace(PRICE_RE, "").replace(/\s{2,}/g, " "));
    if (name.length < 6) {
      const parentText = cleanText($(el).parent().text());
      if (parentText && parentText.length < 260 && PRICE_RE.test(parentText)) {
        name = cleanText(parentText.replace(PRICE_RE, "").replace(/\s{2,}/g, " "));
      }
    }

    const bad = /kontakt|galerie|pivovar|přidej se k nám|cookies|ochrana osobních údajů|zásady/i.test(name);
    if (!name || name.length < 6 || bad) return;

    candidates.push({ name, price, day: null });
  });

  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const k = `${c.name}__${c.price}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out.slice(0, 60);
}

async function loadRestaurants() {
  const kvList = await kv.get("restaurants:list");
  if (Array.isArray(kvList) && kvList.length) return kvList;

  // fallback: restaurants.json v rootu
  try {
    const p = path.join(process.cwd(), "restaurants.json");
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return data.map((r, i) => ({
        id: r.id || String(i + 1),
        name: r.name,
        url: r.url,
        mode: normalizeMode(r.mode),
      }));
    }
  } catch {
    // ignore
  }

  return [];
}

async function fetchWithTimeout(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

async function buildMenus(type) {
  const restaurants = await loadRestaurants();
  const out = [];

  for (const r of restaurants) {
    const name = r?.name || "Neznámá restaurace";
    const url = r?.url || "";
    const mode = normalizeMode(r?.mode);

    // PDF/obrázek: jen zdroj
    if (isPdf(url) || isImage(url)) {
      out.push({ id: r.id || name, name, url, mode, meals: [] });
      continue;
    }

    // embed režim: neparsovat
    if (mode === "embed") {
      out.push({ id: r.id || name, name, url, mode, meals: [] });
      continue;
    }

    // parse režim
    try {
      const resp = await fetchWithTimeout(url, 15000);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const html = await resp.text();
      const meals = extractMealsHeuristic(html);

      out.push({ id: r.id || name, name, url, mode, meals: meals.length ? meals : [] });
    } catch (e) {
      out.push({ id: r.id || name, name, url, mode, meals: [], error: String(e?.message || e) });
    }
  }

  return out;
}

export default async function handler(req, res) {
  try {
    const type = (req.query?.type === "all") ? "all" : "today";
    const date = todayISO();

    const updatedAt = (await kv.get("restaurants:updatedAt")) || 0;
    const buster = (await kv.get("menus:cacheBuster")) || 0;

    const cacheKey = `menus:${type}:${date}:u${updatedAt}:b${buster}`;

    const cached = await kv.get(cacheKey);
    if (Array.isArray(cached)) {
      return res.status(200).json(cached);
    }

    const menus = await buildMenus(type);

    // 36 hodin
    await kv.set(cacheKey, menus, { ex: 60 * 60 * 36 });

    return res.status(200).json(menus);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "unknown" });
  }
}