import { kv } from "@vercel/kv";

const KEY = "suggestions:list";

function makeId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

async function readList() {
  const fromKv = await kv.get(KEY);
  return Array.isArray(fromKv) ? fromKv : [];
}

async function writeList(list) {
  await kv.set(KEY, list);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const list = await readList();
    // nejnovější nahoře
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return res.status(200).json(list);
  }

  if (req.method === "POST") {
    const { name, menuUrl, submitter, email } = req.body || {};

    const n = String(name || "").trim();
    const e = String(email || "").trim();

    if (!n) return res.status(400).json({ error: "Chybí název restaurace" });
    if (!e) return res.status(400).json({ error: "Chybí email" });
    if (!isValidEmail(e)) return res.status(400).json({ error: "Email nevypadá správně" });

    const item = {
      id: makeId(),
      name: n,
      menuUrl: String(menuUrl || "").trim(),
      submitter: String(submitter || "").trim(),
      email: e,
      createdAt: Date.now()
    };

    const list = await readList();
    list.push(item);
    await writeList(list);

    return res.status(200).json({ ok: true, item });
  }

  if (req.method === "DELETE") {
    const { id } = req.query || {};
    if (!id) return res.status(400).json({ error: "Chybí id" });

    const list = await readList();
    const next = list.filter((x) => x.id !== id);
    await writeList(next);

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}