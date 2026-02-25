import { kv } from "@vercel/kv";

const CACHE_PREFIX = "usda:kcal:";
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dní

function normQuery(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function getEnergyKcalFromFood(food) {
  const nuts = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
  // USDA často používá nutrientName "Energy" (kcal) a/nebo nutrientId 1008
  const energy =
    nuts.find(n => (n.nutrientId === 1008)) ||
    nuts.find(n => String(n.nutrientName || "").toLowerCase() === "energy") ||
    nuts.find(n => String(n.nutrientName || "").toLowerCase().includes("energy"));

  const val = energy?.value;
  if (typeof val !== "number") return null;

  // někdy je v kJ; když je jednotka KCAL, bereme přímo
  const unit = String(energy?.unitName || "").toUpperCase();
  if (unit === "KJ") {
    // 1 kcal = 4.184 kJ
    return Math.round(val / 4.184);
  }
  return Math.round(val);
}

export default async function handler(req, res) {
  try {
    const apiKey = process.env.USDA_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Chybí USDA_KEY ve Vercel Environment Variables." });
    }

    const query = normQuery(req.query.query);
    if (!query) {
      return res.status(400).json({ error: "Chybí query" });
    }

    const cacheKey = CACHE_PREFIX + query;

    // 1) KV cache
    try {
      const cached = await kv.get(cacheKey);
      if (cached && typeof cached === "object" && "kcal" in cached) {
        return res.status(200).json({ query, kcal: cached.kcal, cached: true });
      }
    } catch {
      // ignore cache errors
    }

    // 2) USDA search
    const url =
      "https://api.nal.usda.gov/fdc/v1/foods/search" +
      `?query=${encodeURIComponent(query)}` +
      `&pageSize=5` +
      `&api_key=${encodeURIComponent(apiKey)}`;

    const r = await fetch(url, { headers: { "User-Agent": "menu03/1.0" } });
    if (!r.ok) {
      return res.status(502).json({ error: `USDA error ${r.status}` });
    }

    const data = await r.json();
    const foods = Array.isArray(data?.foods) ? data.foods : [];

    let kcal = null;
    for (const f of foods) {
      const v = getEnergyKcalFromFood(f);
      if (typeof v === "number") {
        kcal = v;
        break;
      }
    }

    // 3) uložit do KV (i když kcal=null, ať se to neptá pořád dokola)
    try {
      // @vercel/kv podporuje set s options { ex: seconds }
      await kv.set(cacheKey, { kcal, ts: Date.now() }, { ex: CACHE_TTL_SECONDS });
    } catch {
      // ignore
    }

    return res.status(200).json({ query, kcal, cached: false });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "unknown" });
  }
}