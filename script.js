// Stav aplikace
let restaurantsList = [];     // seznam restaurací z /api/restaurants (id, name, url)
let menusCache = [];          // posledně načtený výsledek z /api/getMenus
let currentType = "today";    // today / all

const LS_KEY = "menu03:filters"; // { [restaurantNameLower]: true/false }

// ---------- Filtry (localStorage) ----------
function loadFilters() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveFilters(filters) {
  localStorage.setItem(LS_KEY, JSON.stringify(filters));
}

function setFilter(name, enabled) {
  const filters = loadFilters();
  filters[String(name).toLowerCase()] = !!enabled;
  saveFilters(filters);
}

function isEnabledByFilter(name) {
  const filters = loadFilters();
  const key = String(name).toLowerCase();
  // default: pokud není nastaveno, tak ZOBRAZIT
  return filters[key] !== false;
}

// ---------- UI: render filtrů ----------
function renderFilters() {
  const container = document.getElementById("filterContainer");
  if (!container) return;

  if (!restaurantsList || restaurantsList.length === 0) {
    container.innerHTML = `<div class="small-muted">Zatím žádné restaurace.</div>`;
    return;
  }

  const html = restaurantsList.map(r => {
    const checked = isEnabledByFilter(r.name) ? "checked" : "";
    const id = `flt_${(r.id || r.name).replace(/[^a-zA-Z0-9_-]/g, "")}`;
    return `
      <label class="filter-item" for="${id}">
        <input type="checkbox" id="${id}" data-name="${escapeHtmlAttr(r.name)}" ${checked}>
        <span>${escapeHtml(r.name)}</span>
      </label>
    `;
  }).join("");

  container.innerHTML = html;

  // napojení eventů
  container.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", (e) => {
      const name = e.target.getAttribute("data-name");
      setFilter(name, e.target.checked);
      renderMenus(); // okamžitý filtr bez reloadu
    });
  });
}

function selectAll(enabled) {
  restaurantsList.forEach(r => setFilter(r.name, enabled));
  renderFilters();
  renderMenus();
}

// ---------- Načtení seznamu restaurací (pro filtr) ----------
async function loadRestaurantsList() {
  try {
    const resp = await fetch("/api/restaurants");
    if (!resp.ok) throw new Error("GET /api/restaurants " + resp.status);
    const data = await resp.json();
    restaurantsList = Array.isArray(data) ? data : [];
  } catch {
    restaurantsList = [];
  }
  renderFilters();
}

// ---------- Načtení menu (jednou) + render ----------
async function loadToday() {
  currentType = "today";
  await loadMenus("today");
}

async function loadAll() {
  currentType = "all";
  await loadMenus("all");
}

async function loadMenus(type) {
  // načteme menu z API (tohle je jediné síťové načtení menu)
  const res = await fetch("/api/getMenus?type=" + encodeURIComponent(type));
  const data = await res.json();
  menusCache = Array.isArray(data) ? data : [];
  renderMenus();
}

function renderMenus() {
  const container = document.getElementById("menuContainer");
  container.innerHTML = "";

  // aplikuj filtr na už načtená data (bez reloadu stránky)
  const filteredRestaurants = (menusCache || []).filter(r => isEnabledByFilter(r.name));

  if (!filteredRestaurants.length) {
    container.innerHTML = `<div class="restaurant"><div class="small-muted">Podle filtru není vybraná žádná restaurace.</div></div>`;
    return;
  }

  filteredRestaurants.forEach(r => {
    const div = document.createElement("div");
    div.className = "restaurant";
    div.innerHTML = `<h3>${escapeHtml(r.name)}</h3>`;

    (r.meals || []).forEach(m => {
      const mealDiv = document.createElement("div");
      mealDiv.className = "meal";

      const price = m.price ? `${m.price} Kč` : "—";
      const day = m.day ? `(${m.day})` : "";
      const kcal = (m.calories ?? "?");

      mealDiv.innerHTML = `
        <div><b>${escapeHtml(m.name)}</b> ${escapeHtml(day)}</div>
        <div>💰 ${escapeHtml(price)} | 🔥 ${escapeHtml(String(kcal))} kcal</div>
        <hr>
      `;
      div.appendChild(mealDiv);
    });

    container.appendChild(div);
  });
}

function openAdmin() {
  window.location.href = "/admin.html";
}

// ---------- mini-escapes ----------
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeHtmlAttr(str) {
  return escapeHtml(str);
}

// ---------- Start ----------
(async function init() {
  // 1) nejdřív načti seznam restaurací (pro filtry)
  await loadRestaurantsList();

  // 2) pak načti výchozí menu
  await loadToday();
})();