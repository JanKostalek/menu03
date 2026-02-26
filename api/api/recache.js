import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Buster pro serverovou cache menu – změna => vynucení nového cachování
    const now = Date.now();
    await kv.set("menus:cacheBuster", now);

    return res.status(200).json({ ok: true, cacheBuster: now });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "unknown" });
  }
}