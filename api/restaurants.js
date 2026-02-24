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

export default async function handler(req, res) {
  if (req.method === "GET") {
    const list = (await kv.get(KEY)) || readFallbackJson();
    return res.status(200).json(list);
  }

  if (req.method === "POST") {
    const { name, url } = req.body || {};
    if (!name || !url) return res.status(400).json({ error: "Chybí name nebo url" });

    const current = (await kv.get(KEY)) || readFallbackJson();

    const next = [
      ...current,
      { name: String(name).trim(), url: String(url).trim() }
    ];

    await kv.set(KEY, next);
    return res.status(200).json({ ok: true, count: next.length });
  }

  res.status(405).json({ error: "Method not allowed" });
}