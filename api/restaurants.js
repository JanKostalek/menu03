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
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function normalizeMode(mode) {
  const m = String(mode || "").trim().toLowerCase();
  if (m === "embed" || m === "parse") return m;
  return "parse";
}

function normalizeRestaurant(r) {
  if (!r) return null;
  const name = String(r.name || "").trim();
  const url = String(r.url || "").trim();
  if (!name || !url) return null;

  const mode = normalizeMode(r.mode);
  return { id: r.id || makeId(), name, url, mode };
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
    // lokálně bez KV fallback
  }

  return fallback;
}

async function writeList(list) {
  await kv.set(KEY, list);

  // invalidate menu cache
  const now = Date.now();
  await kv.set("restaurants:updatedAt", now);
  await kv.set("menus:cacheBuster", now);
}

function applyUpdate(list, { id, mode, name, url }) {
  if (!id) return { ok: false, status: 400, error: "Chybí id" };

  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return { ok: false, status: 404, error: "Restaurace nenalezena" };

  const current = list[idx];

  const updated = {
    ...current,
    ...(typeof name === "string" ? { name: name.trim() } : {}),
    ...(typeof url === "string" ? { url: url.trim() } : {}),
    ...(mode ? { mode: normalizeMode(mode) } : {}),
  };

  if (!updated.name || !updated.url) {
    return { ok: false, status: 400, error: "Neplatná data (name/url nesmí být prázdné)" };
  }

  const next = [...list];
  next[idx] = updated;
  return { ok: true, item: updated, list: next };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const list = await readList();
    return res.status(200).json(list);
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const action = String(body.action || "").toLowerCase();

    // UPDATE přes POST (kvůli kompatibilitě)
    if (action === "update") {
      const list = await readList();
      const result = applyUpdate(list, body);
      if (!result.ok) return res.status(result.status).json({ error: result.error });

      await writeList(result.list);
      return res.status(200).json({ ok: true, item: result.item, list: result.list });
    }

    // ADD (původní chování)
    const { name, url, mode } = body;
    if (!name || !url) return res.status(400).json({ error: "Chybí name nebo url" });

    const list = await readList();
    const next = [
      ...list,
      {
        id: makeId(),
        name: String(name).trim(),
        url: String(url).trim(),
        mode: normalizeMode(mode),
      },
    ];

    await writeList(next);
    return res.status(200).json({ ok: true, list: next });
  }

  // (Volitelně) nechávám PUT také – kdyby to někdy začalo fungovat
  if (req.method === "PUT") {
    const body = req.body || {};
    const list = await readList();
    const result = applyUpdate(list, body);
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    await writeList(result.list);
    return res.status(200).json({ ok: true, item: result.item, list: result.list });
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