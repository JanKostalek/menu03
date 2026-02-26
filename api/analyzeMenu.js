import pdf from "pdf-parse";

function looksLikePdf(url) {
  return String(url || "").toLowerCase().includes(".pdf");
}

function pickLines(text) {
  // Rozsekat na řádky a vyčistit
  return String(text || "")
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeLine(line) {
  return String(line || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isProbablyHeading(line) {
  const s = normalizeLine(line);
  if (s.length <= 2) return true;

  // typické nadpisy
  if (
    /^(menu|poledn(i|í)\s+menu|denn(i|í)\s+menu|t(ý|y)denn(i|í)\s+menu|nab[ií]dka|pol[eě]vka|pol[eě]vky|hlavn[ií]\s+j[ií]dlo|specialita|dezert|p[ií]loha|sal[aá]t)\b/i.test(
      s
    )
  )
    return true;

  return false;
}

function extractDishCandidates(text) {
  const lines = pickLines(text).map(normalizeLine);

  // Heuristika: bereme řádky, které vypadají jako jídla:
  // - nejsou to URL/telefon/email
  // - nejsou to typické nadpisy
  // - nejsou to prázdné/krátké řádky
  const candidates = [];
  for (const line of lines) {
    const s = line;
    if (!s) continue;
    if (s.length < 4) continue;

    // vyhoď URL, tel, email
    if (/https?:\/\//i.test(s)) continue;
    if (/\b\d{3}\s*\d{3}\s*\d{3}\b/.test(s)) continue;
    if (/\S+@\S+\.\S+/.test(s)) continue;

    // vyhoď čisté ceny / čisté datum
    if (/^\d{1,4}\s*(?:kč|czk|,-)?$/i.test(s)) continue;
    if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(s)) continue;

    // typické nadpisy
    if (isProbablyHeading(s)) continue;

    // musí obsahovat aspoň nějaká písmena
    if (!/[a-zá-ž]/i.test(s)) continue;

    const clipped = s.length > 140 ? s.slice(0, 140) + "…" : s;
    candidates.push(clipped);
  }

  // deduplikace (case-insensitive)
  const seen = new Set();
  const uniq = [];
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(c);
  }

  return uniq.slice(0, 80);
}

function classifyDishName(name) {
  const s = String(name || "").toLowerCase();

  // velmi hrubé heuristiky (jen podle názvu)
  const hasChicken = /\b(kur(ec|e|í)|chicken)\b/.test(s);
  const hasPork = /\b(vep[rř]ov|krkov|bůček|slanina|pork)\b/.test(s);
  const hasBeef = /\b(hov[eě]z|beef|steak)\b/.test(s);
  const hasFish = /\b(ryb|losos|tresk|tu[nň]a[k]?|fish)\b/.test(s);

  const meatWords =
    /\b(ku[rř]|vep[rř]|hov[eě]z|krůt|kachen|kachn|jehn[eě]|telec|zv[eěř]|slanina|šunka|uzen|sal[aá]m|klob[aá]s|tatar[aá]k|p[aá]rek|špek)\b/.test(
      s
    );
  const fishWords =
    /\b(ryb|losos|tresk|tu[nň]a|sardink|kreveta|krevety|chobotnic|mušl|calamari)\b/.test(
      s
    );

  const vegWords =
    /\b(vegetari[aá]n|vegan|vegansk|tofu|tempeh|falafel|sýr|eidam|hermel[ií]n|mozzarella|ricotta|gorgonzola|gnocchi|tvaroh|houby|houb|žampion|špen[aá]t|cuketa|lilek|brokolic|květ[aá]k|cizrna|čočka|fazole|hr[aá]ch|seitan)\b/.test(
      s
    );
  const clearlyNonVeg =
    /\b(šunka|slanina|uzen|sal[aá]m|klob[aá]s|p[aá]rek|tuna|losos|krevety|ančovi)\b/.test(
      s
    );

  const vegetarianish = vegWords && !clearlyNonVeg && !meatWords && !fishWords;

  if (hasChicken) return { tag: "chicken", label: "Kuřecí" };
  if (hasPork) return { tag: "pork", label: "Vepřové" };
  if (hasBeef) return { tag: "beef", label: "Hovězí" };
  if (hasFish) return { tag: "fish", label: "Ryby/mořské plody" };
  if (vegetarianish) return { tag: "veg", label: "Vegetariánské (odhad)" };

  return { tag: "other", label: "Ostatní" };
}

function buildRecommendation(dishes) {
  const groups = {
    chicken: [],
    pork: [],
    beef: [],
    fish: [],
    veg: [],
    other: [],
  };

  for (const d of dishes) {
    const c = classifyDishName(d);
    groups[c.tag].push(d);
  }

  const pick = (arr, n = 3) => arr.slice(0, n);

  const total =
    groups.chicken.length +
    groups.pork.length +
    groups.beef.length +
    groups.fish.length +
    groups.veg.length +
    groups.other.length;

  if (total === 0) {
    return { summary: "", groups };
  }

  const lines = [];

  if (groups.chicken.length) {
    lines.push(`Pokud máš rád kuřecí: ${pick(groups.chicken).join(" • ")}`);
  }
  if (groups.pork.length) {
    lines.push(`Pokud chceš vepřové: ${pick(groups.pork).join(" • ")}`);
  }
  if (groups.beef.length) {
    lines.push(`Pokud chceš hovězí: ${pick(groups.beef).join(" • ")}`);
  }
  if (groups.fish.length) {
    lines.push(
      `Pokud chceš rybu/mořské plody: ${pick(groups.fish).join(" • ")}`
    );
  }

  if (groups.veg.length) {
    lines.push(
      `Pokud hledáš vegetariánskou stravu (odhad podle názvu): ${pick(
        groups.veg
      ).join(" • ")}`
    );
  } else {
    lines.push(
      "Vegetariánské jídlo jsem podle názvů nenašel (může to být jen tím, jak je menu napsané)."
    );
  }

  if (
    !groups.chicken.length &&
    !groups.pork.length &&
    !groups.beef.length &&
    !groups.fish.length &&
    groups.other.length
  ) {
    lines.push(`Další položky: ${pick(groups.other, 5).join(" • ")}`);
  }

  return { summary: lines.join("\n\n"), groups };
}

export default async function handler(req, res) {
  try {
    const { url } = req.query || {};
    if (!url) {
      res.status(400).json({ ok: false, error: "Chybí parametr url" });
      return;
    }

    if (!looksLikePdf(url)) {
      res
        .status(400)
        .json({ ok: false, error: "URL nevypadá jako PDF (neobsahuje .pdf)" });
      return;
    }

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "menu03-bot/1.0 (+vercel)",
      },
    });

    if (!resp.ok) {
      res
        .status(502)
        .json({
          ok: false,
          error: `Nepodařilo se stáhnout PDF: ${resp.status} ${resp.statusText}`,
        });
      return;
    }

    const arrayBuffer = await resp.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    // bezpečnostní limit (cca 8 MB)
    const MAX = 8 * 1024 * 1024;
    if (buf.length > MAX) {
      res.status(413).json({ ok: false, error: "PDF je moc velké (limit ~8 MB)" });
      return;
    }

    const parsed = await pdf(buf);
    const text = parsed?.text || "";
    const pages = parsed?.numpages ?? null;

    const dishes = extractDishCandidates(text);
    const recommendations = buildRecommendation(dishes);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      meta: {
        pages,
        dishCount: dishes.length,
      },
      dishes,
      recommendations,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}