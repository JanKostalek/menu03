import { kv } from "@vercel/kv";
import fs from "fs";
import path from "path";

const KEY = "restaurants:list";

function readFallbackJson() {
  const filePath = path.resolve("./restaurants.json");
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
}

function makeId() {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

function normalizeRestaurant(r) {
  // podpora starších záznamů bez id
  if (!r) return null;
  const name = String(r.name || "").trim();
  const url = String(r.url || "").trim();
  if (!name || !url) return null;
  return { id: r.id || makeId(), name, url };
}

async function readList() {
  const fallback = readFallbackJson().map(normalizeRestaurant).filter(Boolean);

  try {
    const fromKv = await kv.get(KEY);
    if (Array.isArray(fromKv)) {
      const normalized = fromKv.map(normalizeRestaurant).filter(Boolean);
      return normalized.length ? normalized : fallback;
    }
  } catch {
    // KV nemusí být dostupné v lokálu – pak jedeme fallback
  }

  return fallback;
}

async function writeList(list) {
  // ukládáme jen do KV (trvalé na Vercelu)
  await kv.set(KEY, list);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const list = await readList();
    return res.status(200).json(list);
  }

  if (req.method === "POST") {
    const { name, url } = req.body || {};
    if (!name || !url) return res.status(400).json({ error: "Chybí name nebo url" });

    const list = await readList();
    const next = [
      ...list,
      {
        id: makeId(),
        name: String(name).trim(),
        url: String(url).trim(),
      },
    ];

    await writeList(next);
    return res.status(200).json({ ok: true, list: next });
  }

  if (req.method === "DELETE") {
    const { id } = req.query || {};
    if (!id) return res.status(400).json({ error: "Chybí id" });

    const list = await readList();
    const next = list.filter((r) => r.id !== id);

    await writeList(next);
    return res.status(200).json({ ok: true, list: next });
  }

  return res.status(405).json({ error: "Method not allowed" });
}