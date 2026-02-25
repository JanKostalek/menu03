import { kv } from "@vercel/kv";
import cheerio from "cheerio";
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

function extractMealsFromHtml(html) {
  const $ = cheerio.load(html);

  // vyhoď skripty/styly
  $("script, style, noscript").remove();

  // prioritně zkus najít něco jako "menu" sekci – když ne, vezmeme celý body
  let root = $("main");
  if (!root || root.length === 0) root = $("#content");
  if (!root || root.length === 0) root = $("body");

  const text = cleanText(root.text());
  if (!text) return [];

  // rozdělení na řádky, odfiltruj krátké/nesmysly
  const lines = text
    .split("\n")
    .map(l => cleanText(l))
    .filter(l => l.length >= 3);

  // lehká deduplikace po sobě
  const uniq = [];
  for (const l of lines) {
    if (uniq.length === 0 || uniq[uniq.length - 1] !== l) uniq.push(l);
  }

  // Převod na "meals"
  return uniq.slice(0, 200).map(name => ({
    name,
    price: null,
    day: null,
    calories: undefined
  }));
}

async function loadRestaurants() {
  // primárně KV (stejné jako /api/restaurants)
  const kvList = await kv.get("restaurants:list");
  if (Array.isArray(kvList) && kvList.length) return kvList;

  // fallback: restaurants.json v rootu (pokud existuje)
  try {
    const p = path.join(process.cwd(), "restaurants.json");
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      // sjednotit na {id,name,url}
      return data.map((r, i) => ({
        id: r.id || String(i + 1),
        name: r.name,
        url: r.url
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

    // PDF / obrázek – zatím neparsujeme
    if (isPdf(url) || isImage(url)) {
      out.push({
        id: r.id || name,
        name,
        url,
        meals: [
          {
            name: "Menu je PDF/obrázek – parsování zatím není zapnuté.",
            price: null,
            day: null,
            calories: undefined
          }
        ]
      });
      continue;
    }

    // HTML – stáhnout a vytáhnout text
    try {
      const resp = await fetchWithTimeout(url, 15000);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const html = await resp.text();
      const meals = extractMealsFromHtml(html);

      out.push({
        id: r.id || name,
        name,
        url,
        meals: meals.length ? meals : [
          {
            name: "Menu se nepodařilo z textu rozpoznat.",
            price: null,
            day: null,
            calories: undefined
          }
        ]
      });
    } catch (e) {
      out.push({
        id: r.id || name,
        name,
        url,
        meals: [
          {
            name: "Menu se nepodařilo načíst.",
            price: null,
            day: null,
            calories: undefined
          }
        ],
        error: String(e?.message || e)
      });
    }
  }

  // type zatím neovlivňuje parsing; je připraveno do budoucna
  return out;
}

export default async function handler(req, res) {
  try {
    const type = (req.query?.type === "all") ? "all" : "today";
    const date = todayISO();

    // ===== SERVER CACHE (KV) =====
    // klíč je po dni → automatická invalidace „včerejší a starší“
    const cacheKey = `menus:${type}:${date}`;
    const cached = await kv.get(cacheKey);

    if (Array.isArray(cached)) {
      return res.status(200).json(cached);
    }

    // pokud není v cache, vyrob a ulož
    const menus = await buildMenus(type);

    // ulož na 36h (přežije noc; nový den má jiný klíč)
    await kv.set(cacheKey, menus, { ex: 60 * 60 * 36 });

    return res.status(200).json(menus);
  } catch (e) {
    return res.status(500).json({ error: e?.message || "unknown" });
  }
}