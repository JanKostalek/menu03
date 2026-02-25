// menu03 – stabilní layout + robustní render
// Pozn.: Funguje i když některé zdroje nejdou vložit do iframe – vždy nabídne "Otevřít" odkaz.

const PASSWORD = "H3510";

let mode = "today"; // "today" | "all"
let restaurants = [];
let selectedIds = new Set();

const el = (id) => document.getElementById(id);

function setMode(newMode) {
  mode = newMode;
  el("modeLabel").textContent = `Režim: ${mode === "today" ? "Dnešní menu" : "Celé menu"}`;
  refreshMenus();
}

function toggleSelection(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  renderRestaurantList();
  refreshMenus();
}

function selectAll() {
  selectedIds = new Set(restaurants.map(r => r.id));
  renderRestaurantList();
  refreshMenus();
}

function clearSelection() {
  selectedIds.clear();
  renderRestaurantList();
  refreshMenus();
}

function renderRestaurantList() {
  const root = el("restaurantsList");
  root.innerHTML = "";

  restaurants.forEach(r => {
    const btn = document.createElement("button");
    btn.className = "restaurant-pill" + (selectedIds.has(r.id) ? " is-active" : "");
    btn.type = "button";
    btn.textContent = r.name || r.id;
    btn.addEventListener("click", () => toggleSelection(r.id));
    root.appendChild(btn);
  });

  if (restaurants.length === 0) {
    root.innerHTML = `<div class="menu-card__empty">Žádné restaurace v restaurants.json</div>`;
  }
}

function updateSelectionLabel() {
  if (selectedIds.size === 0) {
    el("selectionLabel").textContent = "Vyber restauraci vlevo.";
    return;
  }
  const names = restaurants
    .filter(r => selectedIds.has(r.id))
    .map(r => r.name || r.id);
  el("selectionLabel").textContent = `Vybráno: ${names.join(", ")}`;
}

function renderLoading() {
  el("menusArea").innerHTML = `<div class="menu-card"><div class="menu-card__empty">Načítám menu…</div></div>`;
}

function renderMenus(cards) {
  const root = el("menusArea");
  root.innerHTML = cards.join("\n");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Volá serverless API, ale je tolerantní:
 * - pokud API nevrátí očekávaný tvar, zobrazí aspoň odkazy na zdroj
 */
async function fetchMenuForRestaurant(r) {
  // Primárně zkusíme serverless endpoint (pokud existuje)
  // Očekávání: /api/getMenus?restaurantId=...&mode=today|all
  // Fallback: použijeme r.url (source) jako odkaz.
  const apiUrl = `/api/getMenus?restaurantId=${encodeURIComponent(r.id)}&mode=${encodeURIComponent(mode)}`;

  try {
    const res = await fetch(apiUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();

    // Tolerantní čtení
    const title = (data.restaurant?.name || r.name || r.id);
    const sourceUrl = data.sourceUrl || data.restaurant?.sourceUrl || r.sourceUrl || r.url || "";
    const pdfUrl = data.pdfUrl || data.restaurant?.pdfUrl || "";
    const text = data.menuText || data.text || data.menu || "";

    return {
      ok: true,
      title,
      sourceUrl,
      pdfUrl,
      text: text ? String(text) : ""
    };
  } catch (e) {
    // Fallback bez API
    return {
      ok: false,
      title: (r.name || r.id),
      sourceUrl: r.sourceUrl || r.url || "",
      pdfUrl: "",
      text: ""
    };
  }
}

function cardHtml({ title, sourceUrl, pdfUrl, text, ok }) {
  const safeTitle = escapeHtml(title);

  const sourcePart = sourceUrl
    ? `<span>Zdroj: <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">otevřít</a></span>`
    : `<span class="badge">Bez zdroje</span>`;

  const pdfPart = pdfUrl
    ? `<span>PDF menu: <a href="${pdfUrl}" target="_blank" rel="noopener noreferrer">Otevřít PDF</a></span>`
    : "";

  const apiBadge = ok ? `<span class="badge">API</span>` : `<span class="badge">Fallback</span>`;

  const body =
    text && text.trim().length > 0
      ? `<div class="menu-card__body">${escapeHtml(text)}</div>`
      : `<div class="menu-card__body menu-card__empty">Menu se nepodařilo načíst jako text. Použij odkaz na zdroj.</div>`;

  return `
    <article class="menu-card">
      <h3 class="menu-card__title">${safeTitle}</h3>
      <div class="menu-card__meta">
        ${apiBadge}
        ${sourcePart}
        ${pdfPart}
      </div>
      ${body}
    </article>
  `;
}

async function refreshMenus() {
  updateSelectionLabel();

  const selected = restaurants.filter(r => selectedIds.has(r.id));
  if (selected.length === 0) {
    el("menusArea").innerHTML = "";
    return;
  }

  renderLoading();

  const results = await Promise.all(selected.map(fetchMenuForRestaurant));
  const cards = results.map(cardHtml);
  renderMenus(cards);
}

async function loadRestaurants() {
  const res = await fetch("restaurants.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`restaurants.json ${res.status}`);

  const data = await res.json();

  // Podporujeme oba tvary:
  // 1) { restaurants: [...] }
  // 2) [ ... ]
  const list = Array.isArray(data) ? data : (data.restaurants || []);

  // Normalizace: id musí existovat
  restaurants = list.map((r, idx) => ({
    id: r.id || r.slug || r.key || String(idx),
    name: r.name || r.title || r.id || r.slug || `Restaurace ${idx + 1}`,
    sourceUrl: r.sourceUrl || r.url || r.link || ""
  }));

  renderRestaurantList();
}

function setupEvents() {
  el("btnToday").addEventListener("click", () => setMode("today"));
  el("btnAll").addEventListener("click", () => setMode("all"));

  el("btnSelectAll").addEventListener("click", selectAll);
  el("btnClear").addEventListener("click", clearSelection);

  el("btnAdmin").addEventListener("click", () => {
    const pass = prompt("Zadej heslo:");
    if (pass === PASSWORD) {
      window.location.href = "admin.html";
    } else if (pass !== null) {
      alert("Špatné heslo.");
    }
  });

  el("btnSuggest").addEventListener("click", () => {
    // pokud nemáš stránku, jen to nahlásí – můžeš si ji doplnit později
    // případně přesměruj na admin.html nebo vlastní URL
    window.location.href = "suggest.html";
  });
}

(async function init() {
  setupEvents();
  setMode("today");
  try {
    await loadRestaurants();
  } catch (e) {
    el("restaurantsList").innerHTML =
      `<div class="menu-card__empty">Nepodařilo se načíst restaurants.json</div>`;
    console.error(e);
  }
})();