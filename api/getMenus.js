import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";

const CZ_DAYS = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

function normalizeSpaces(s) {
  return (s || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function isProbablyPdfOrImage(url) {
  const u = (url || "").toLowerCase();
  return u.endsWith(".pdf") || /\.(png|jpg|jpeg|webp|gif)(\?.*)?$/.test(u);
}

function pickTodayDayCz() {
  return CZ_DAYS[new Date().getDay()];
}

function extractPriceCzk(text) {
  // 165 Kč, 165,-, 165,- Kč, 165 Kč.
  const m =
    text.match(/(\d{1,4})\s*(kč|Kč)\b/) ||
    text.match(/(\d{1,4})\s*,-\b/) ||
    text.match(/(\d{1,4})\s*,-\s*(kč|Kč)\b/);
  return m ? Number(m[1]) : null;
}

function stripAllergens(text) {
  // odstraní "(1,3,7,12)" apod.
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
    t.includes("nabídku pro vás připravujeme") ||
    t.includes("informační povinnost") ||
    t.includes("gdpr")
  );
}

/**
 * Univerzální parser pro "textové HTML":
 * - projde sekvenčně hodně elementů
 * - umí:
 *   A) řádek "jídlo ... 165 Kč" -> vytvoří meal rovnou
 *   B) řádek "jídlo ..." + další řádek "(...alergeny...) 165 Kč" -> doplní cenu k předchozímu
 *   C) zachytí den podle nadpisu/řádku "Pondělí/Úterý/..."
 */
function parseTextMenuFromHtml(html) {
  const $ = cheerio.load(html);

  // Vezmeme hodně běžných elementů v pořadí (Salanda/Kandelábr/ostatní)
  const nodes = $("h1,h2,h3,h4,li,p,div,span").toArray();

  const lines = [];
  for (const el of nodes) {
    const text = normalizeSpaces($(el).text());
    if (!text) continue;

    // rozbijeme i vícerádkové bloky
    text.split("\n").map(normalizeSpaces).forEach((l) => {
      if (l) lines.push(l);
    });
  }

  let currentDay = null;
  const meals = [];
  let lastMeal = null;

  for (const raw of lines) {
    const line = normalizeSpaces(raw);
    if (looksLikeNoise(line)) continue;

    // den (někdy je v menu jen jednou, někdy opakovaně)
    if (isDayLine(line)) {
      currentDay = line.toLowerCase();
      lastMeal = null;
      continue;
    }

    // když je to jen alergeny+Kč (Salanda často: "(1,3,7,12) 179 Kč")
    if (lastMeal) {
      const priceOnly = extractPriceCzk(line);
      const onlyAllergensAndPrice =
        priceOnly !== null &&
        stripAllergens(line).replace(/(\d{1,4}\s*(kč|Kč)\b)|(\d{1,4}\s*,-\b)/g, "").trim().length === 0;

      if (onlyAllergensAndPrice && !lastMeal.price) {
        lastMeal.price = priceOnly;
        continue;
      }
    }

    // řádek obsahuje cenu i text -> rovnou meal
    const price = extractPriceCzk(line);
    if (price !== null) {
      const name = stripAllergens(
        line
          .replace(/(\d{1,4})\s*(kč|Kč)\b.*$/i, "") // odřízne "165 Kč ..."
          .replace(/(\d{1,4})\s*,-.*$/i, "")       // odřízne "165,- ..."
      );

      // aby nevznikaly prázdné položky
      if (name && name.length >= 3) {
        lastMeal = { name, price, day: currentDay };
        meals.push(lastMeal);
        continue;
      }
    }

    // jinak: text bez ceny -> bereme jako potenciální jídlo (cena může být na dalším řádku)
    // typicky: "150 g Segedínský guláš..." a až další řádek "(...) 165 Kč"
    if (line.length >= 6 && !/^\(?\d/.test(line)) {
      const name = stripAllergens(line);
      lastMeal = { name, price: null, day: currentDay };
      meals.push(lastMeal);
      continue;
    }
  }

  // odfiltrujeme duplicity typu "Pondělí Úterý Středa ..." (Salanda má v textu i řádek se všemi dny)
  const cleaned = meals.filter((m) => {
    const t = m.name.toLowerCase();
    const allDaysInOne =
      CZ_DAYS.filter((d) => t.includes(d)).length >= 3; // "Pondělí Úterý Středa..."
    return !allDaysInOne;
  });

  // odfiltrujeme „Nabídku pro Vás připravujeme“
  return cleaned.filter((m) => !m.name.toLowerCase().includes("nabídku pro vás připravujeme"));
}

async function fetchHtml(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "menu02-bot/1.0 (+vercel)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  return { ok: resp.ok, status: resp.status, text: resp.ok ? await resp.text() : "" };
}

async function parseRestaurant(url) {
  // 1) základní fetch
  const primary = await fetchHtml(url);
  if (!primary.ok) return { meals: [], error: `Nepodařilo se načíst (${primary.status})` };

  let meals = parseTextMenuFromHtml(primary.text);

  // 2) Kandelábr: serverově na /poledni-menu/ bývá obsah bez menu (jen šablona + GDPR) :contentReference[oaicite:3]{index=3}
  // -> když nic nevytáhneme, zkusíme fallback na menicka.cz (tam bývá menu v HTML textu) :contentReference[oaicite:4]{index=4}
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");

  if (meals.length === 0 && host.includes("restaurantkandelabr.cz")) {
    const fallbackUrl = "https://www.menicka.cz/2277-restaurant-kandelabr.html";
    const fb = await fetchHtml(fallbackUrl);
    if (fb.ok) {
      meals = parseTextMenuFromHtml(fb.text);
    }
  }

  return { meals, error: null };
}

export default async function handler(req, res) {
  const filePath = path.resolve("./restaurants.json");
  const restaurants = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (req.method === "POST") {
    const { name, url } = req.body || {};
    if (!name || !url) return res.status(400).json({ error: "Chybí name nebo url" });

    restaurants.push({ name, url });
    fs.writeFileSync(filePath, JSON.stringify(restaurants, null, 2));
    return res.status(200).json({ message: "OK" });
  }

  const type = (req.query.type || "today").toString(); // today / all
  const todayName = pickTodayDayCz();

  const out = [];

  for (const r of restaurants) {
    try {
      if (isProbablyPdfOrImage(r.url)) {
        out.push({
          name: r.name,
          meals: [{ name: "Menu je PDF/obrázek – parsování zatím není zapnuté.", price: null, day: null, calories: null }],
        });
        continue;
      }

      const { meals, error } = await parseRestaurant(r.url);

      let finalMeals = meals;

      // filtr "today" (pokud parser den našel)
      if (type === "today") {
        const withDay = finalMeals.filter((m) => (m.day || "").toLowerCase() === todayName);
        // když web den neuvádí, necháme vše (ať to není prázdné)
        finalMeals = withDay.length > 0 ? withDay : finalMeals;
      }

      if (finalMeals.length === 0) {
        out.push({
          name: r.name,
          meals: [{ name: error || "Menu se nepodařilo vyčíst (prázdný výstup).", price: null, day: null, calories: null }],
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
        name: r.name,
        meals: [{ name: `Chyba: ${e?.message || "unknown"}`, price: null, day: null, calories: null }],
      });
    }
  }

  res.status(200).json(out);
}