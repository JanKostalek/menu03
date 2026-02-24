import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { kv } from "@vercel/kv";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const KV_KEY = "restaurants:list";
const CZ_DAYS = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

function normalizeSpaces(s) {
  return (s || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function isPdf(url) {
  const u = (url || "").toLowerCase();
  return u.endsWith(".pdf") || u.includes(".pdf?");
}

function isImage(url) {
  const u = (url || "").toLowerCase();
  return /\.(png|jpg|jpeg|webp|gif)(\?.*)?$/.test(u);
}

function pickTodayDayCz() {
  return CZ_DAYS[new Date().getDay()];
}

function extractPriceCzk(text) {
  const m =
    text.match(/(\d{1,4})\s*(kč|Kč)\b/) ||
    text.match(/(\d{1,4})\s*,-\b/) ||
    text.match(/(\d{1,4})\s*,-\s*(kč|Kč)\b/);
  return m ? Number(m[1]) : null;
}

function stripAllergens(text) {
  return text.replace(/\(\s*\d+(?:\s*,\s*\d+)*\s*\)/g, "").trim();
}

function isDayLine(line) {
  const t = line.toLowerCase();
  return CZ_DAYS.includes(t);
}

function looksLikeNoise(line) {
  const t = line.toLowerCase();
  return (
    !t ||
    t === "polední menu" ||
    t.includes("otevírací doba") ||
    t.includes("rezervujte") ||
    t.includes("rezervace") ||
    t.includes("kontakt") ||
    t.includes("informační povinnost") ||
    t.includes("gdpr") ||
    t.includes("cookies") ||
    t.includes("alerg") // alergeny často bývají dole jako legenda
  );
}

/**
 * Univerzální parser pro "textové řádky"
 * - den (pondělí/úterý/...) nastaví currentDay
 * - řádek s cenou vytvoří jídlo s cenou
 * - řádek bez ceny vytvoří jídlo bez ceny (cena může být na dalším řádku)
 * - řádek typu "(1,3,7) 179 Kč" doplní cenu k předchozímu jídlu
 */
function parseLinesToMeals(lines) {
  let currentDay = null;
  const meals = [];
  let lastMeal = null;

  for (const raw of lines) {
    const line = normalizeSpaces(raw);
    if (looksLikeNoise(line)) continue;

    if (isDayLine(line)) {
      currentDay = line.toLowerCase();
      lastMeal = null;
      continue;
    }

    // cena samotná (nebo alergeny+cena) -> doplní k předchozímu
    if (lastMeal && !lastMeal.price) {
      const priceOnly = extractPriceCzk(line);
      if (priceOnly !== null) {
        const rest = stripAllergens(line)
          .replace(/(\d{1,4})\s*(kč|Kč)\b/gi, "")
          .replace(/(\d{1,4})\s*,-\b/gi, "")
          .trim();

        if (rest.length === 0) {
          lastMeal.price = priceOnly;
          continue;
        }
      }
    }

    // řádek obsahuje cenu i jídlo
    const price = extractPriceCzk(line);
    if (price !== null) {
      const name = stripAllergens(
        line
          .replace(/(\d{1,4})\s*(kč|Kč)\b.*$/i, "")
          .replace(/(\d{1,4})\s*,-.*$/i, "")
      ).trim();

      if (name && name.length >= 3) {
        lastMeal = { name, price, day: currentDay };
        meals.push(lastMeal);
        continue;
      }
    }

    // text bez ceny -> jídlo (cena může být na dalším řádku)
    if (line.length >= 6 && !/^\(?\d/.test(line)) {
      const name = stripAllergens(line);
      lastMeal = { name, price: null, day: currentDay };
      meals.push(lastMeal);
      continue;
    }
  }

  // odfiltruje řádky, kde jsou vypsané 3+ dny najednou
  return meals.filter((m) => {
    const t = (m.name || "").toLowerCase();
    const dayCount = CZ_DAYS.filter((d) => t.includes(d)).length;
    return dayCount < 3;
  });
}

function parseTextMenuFromHtml(html) {
  const $ = cheerio.load(html);
  const nodes = $("h1,h2,h3,h4,li,p,div,span").toArray();

  const lines = [];
  for (const el of nodes) {
    const text = normalizeSpaces($(el).text());
    if (!text) continue;
    text.split("\n").map(normalizeSpaces).forEach((l) => l && lines.push(l));
  }

  return parseLinesToMeals(lines);
}

async function fetchHtml(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "menu03-bot/1.0 (+vercel)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });

  return { ok: resp.ok, status: resp.status, text: resp.ok ? await resp.text() : "" };
}

async function fetchPdfBuffer(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "menu03-bot/1.0 (+vercel)",
      "Accept": "application/pdf,*/*",
    },
  });
  if (!resp.ok) return { ok: false, status: resp.status, buf: null };

  const ab = await resp.arrayBuffer();
  return { ok: true, status: resp.status, buf: Buffer.from(ab) };
}

async function parsePdfMenu(url) {
  const { ok, status, buf } = await fetchPdfBuffer(url);
  if (!ok) return { meals: [], error: `Nepodařilo se načíst PDF (${status})` };

  let text = "";
  try {
    const data = await pdfParse(buf);
    text = normalizeSpaces(data?.text || "");
  } catch (e) {
    return { meals: [], error: `PDF parse chyba: ${e?.message || "unknown"}` };
  }

  // pokud PDF nemá textovou vrstvu, bývá to prázdné
  if (!text || text.length < 30) {
    return {
      meals: [],
      error: "PDF nejspíš neobsahuje text (scan). Bez OCR to nepřečtu.",
    };
  }

  const lines = text.split("\n").map(normalizeSpaces).filter(Boolean);
  const meals = parseLinesToMeals(lines);

  return { meals, error: null };
}

async function parseRestaurant(url) {
  // PDF
  if (isPdf(url)) {
    return await parsePdfMenu(url);
  }

  // obrázek zatím neumíme (bez OCR)
  if (isImage(url)) {
    return { meals: [], error: "Menu je obrázek – bez OCR ho zatím nepřečtu." };
  }

  // HTML
  const primary = await fetchHtml(url);
  if (!primary.ok) return { meals: [], error: `Nepodařilo se načíst (${primary.status})` };

  let meals = parseTextMenuFromHtml(primary.text);

  // fallback pro Kandelábr
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (meals.length === 0 && host.includes("restaurantkandelabr.cz")) {
      const fallbackUrl = "https://www.menicka.cz/2277-restaurant-kandelabr.html";
      const fb = await fetchHtml(fallbackUrl);
      if (fb.ok) meals = parseTextMenuFromHtml(fb.text);
    }
  } catch {
    // ignore
  }

  return { meals, error: null };
}

function readRestaurantsFallbackJson() {
  const filePath = path.resolve("./restaurants.json");
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
}

async function readRestaurantsFromKVOrFallback() {
  const fallback = readRestaurantsFallbackJson();
  try {
    const fromKv = await kv.get(KV_KEY);
    if (Array.isArray(fromKv) && fromKv.length > 0) return fromKv;
  } catch {
    // KV může být nedostupné lokálně
  }
  return fallback;
}

export default async function handler(req, res) {
  const type = (req.query.type || "today").toString(); // today / all
  const todayName = pickTodayDayCz();

  const restaurants = await readRestaurantsFromKVOrFallback();
  const out = [];

  for (const r of restaurants) {
    try {
      if (!r?.name || !r?.url) continue;

      const { meals, error } = await parseRestaurant(r.url);

      let finalMeals = meals;

      // filtr "today" jen pokud parser našel dny
      if (type === "today") {
        const withDay = finalMeals.filter((m) => (m.day || "").toLowerCase() === todayName);
        finalMeals = withDay.length > 0 ? withDay : finalMeals;
      }

      if (!finalMeals || finalMeals.length === 0) {
        out.push({
          name: r.name,
          meals: [
            {
              name: error || "Menu se nepodařilo vyčíst (prázdný výstup).",
              price: null,
              day: null,
              calories: null,
            },
          ],
        });
        continue;
      }

      out.push({
        name: r.name,
        meals: finalMeals.map((m) => ({
          name: m.name,
          price: m.price ?? null,
          calories: null,
          day: m.day ?? null,
        })),
      });
    } catch (e) {
      out.push({
        name: r?.name || "Neznámá restaurace",
        meals: [
          {
            name: `Chyba: ${e?.message || "unknown"}`,
            price: null,
            day: null,
            calories: null,
          },
        ],
      });
    }
  }

  res.status(200).json(out);
}