let restaurantsList = [];
let menusCache = [];
let currentType = "today";

const COOKIE_FILTERS = "menu03_filters";
const LS_CALORIES = "menu03:caloriesEnabled";

/* ===== COOKIES HELPERS ===== */

function setCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie =
    encodeURIComponent(name) +
    "=" +
    encodeURIComponent(value) +
    "; expires=" +
    expires +
    "; path=/; SameSite=Lax";
}

function getCookie(name) {
  const target = encodeURIComponent(name) + "=";
  const parts = document.cookie.split("; ");
  for (const p of parts) {
    if (p.startsWith(target)) {
      return decodeURIComponent(p.substring(target.length));
    }
  }
  return null;
}

/* ===== KALORIE TOGGLE (zatím jen UI, API přidáme později) ===== */

function caloriesEnabled() {
  return localStorage.getItem(LS_CALORIES) === "1";
}

function setCaloriesEnabled(v) {
  localStorage.setItem(LS_CALORIES, v ? "1" : "0");
  updateCaloriesButton();
}

function toggleCalories() {
  setCaloriesEnabled(!caloriesEnabled());
  renderMenus();
}

function updateCaloriesButton() {
  const btn = document.getElementById("btnCalories");
  if (!btn) return;

  if (caloriesEnabled()) btn.classList.add("active");
  else btn.classList.remove("active");
}

/* ===== FILTRY (COOKIE) ===== */

function loadFilters() {
  try {
    const raw = getCookie(COOKIE_FILTERS);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function saveFilters(filters) {
  // Cookie musí být string; JSON je ok (pozor na velikost – pro pár desítek restaurací v pohodě)
  setCookie(COOKIE_FILTERS, JSON.stringify(filters), 365);
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

  container.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", (e) => {
      const name = e.target.getAttribute("data-name");
      setFilter(name, e.target.checked);
      renderMenus();
    });
  });
}

function selectAll(enabled) {
  restaurantsList.forEach(r => setFilter(r.name, enabled));
  renderFilters();
  renderMenus();
}

/* ===== NAČÍTÁNÍ RESTAURACÍ + MENU ===== */

async function loadRestaurantsList() {
  try {
    const resp = await fetch("/api/restaurants");
    const data = await resp.json();
    restaurantsList = Array.isArray(data) ? data : [];
  } catch {
    restaurantsList = [];
  }
  renderFilters();
}

async function loadToday() {
  currentType = "today";
  await loadMenus("today");
}

async function loadAll() {
  currentType = "all";
  await loadMenus("all");
}

async function loadMenus(type) {
  const res = await fetch("/api/getMenus?type=" + encodeURIComponent(type));
  const data = await res.json();
  menusCache = Array.isArray(data) ? data : [];
  renderMenus();
}

function renderMenus() {
  const container = document.getElementById("menuContainer");
  container.innerHTML = "";

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

      // když kalorie nejsou zapnuté, neukazujeme nic (žádné ---)
      let calorieLine = "";
      if (caloriesEnabled()) {
        const kcal = (m.calories ?? "?");
        calorieLine = ` | 🔥 ${escapeHtml(String(kcal))} kcal`;
      }

      mealDiv.innerHTML = `
        <div><b>${escapeHtml(m.name)}</b> ${escapeHtml(day)}</div>
        <div>💰 ${escapeHtml(price)}${calorieLine}</div>
        <hr>
      `;

      div.appendChild(mealDiv);
    });

    container.appendChild(div);
  });
}

/* ===== NAVIGACE ===== */

function openAdmin() {
  window.location.href = "/admin.html";
}

function openSuggestion() {
  window.open("/suggest.html", "_blank");
}

/* ===== ESCAPE ===== */

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

/* ===== INIT ===== */

(async function init() {
  updateCaloriesButton();
  await loadRestaurantsList();
  await loadToday();
})();