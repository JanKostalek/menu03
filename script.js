let restaurantsList = [];
let menusCache = [];
let currentType = "today";

const COOKIE_FILTERS = "menu03_filters";     // JSON objekt {nameLower: true/false}
const COOKIE_CALORIES = "menu03_calories";   // "1" / "0"
const COOKIE_VISITED = "menu03_visited";     // "1" = už někdy navštívil

// denní cache pro menu (localStorage)
const LS_MENU_CACHE_TODAY = "menu03_menu_cache_today";
const LS_MENU_CACHE_ALL = "menu03_menu_cache_all";
const LS_MENU_CACHE_DATE_TODAY = "menu03_menu_cache_date_today";
const LS_MENU_CACHE_DATE_ALL = "menu03_menu_cache_date_all";

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

/* ===== DATE ===== */

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ===== KALORIE TOGGLE (COOKIE) ===== */

function caloriesEnabled() {
  return getCookie(COOKIE_CALORIES) === "1";
}

function setCaloriesEnabled(v) {
  setCookie(COOKIE_CALORIES, v ? "1" : "0", 365);
  updateCaloriesButton();
}

function toggleCalories() {
  setCaloriesEnabled(!caloriesEnabled());
  renderMenus();
}

function updateCaloriesButton() {
  const btn = document.getElementById("btnCalories");
  if (!btn) return;

  if (caloriesEnabled()) btn.classList.add("active-green");
  else btn.classList.remove("active-green");
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
  // default: zobrazujeme jen to, co je explicitně true
  return filters[key] === true;
}

/* ===== UI: render filtrů (tlačítka) ===== */

function renderFilters() {
  const container = document.getElementById("filterContainer");
  if (!container) return;

  if (!restaurantsList || restaurantsList.length === 0) {
    container.innerHTML = `<div class="small-muted">Zatím žádné restaurace.</div>`;
    return;
  }

  const html = restaurantsList.map((r) => {
    const enabled = isEnabledByFilter(r.name);
    const cls = enabled ? "filter-btn active-green" : "filter-btn";
    return `
      <button type="button" class="${cls}" data-name="${escapeHtmlAttr(r.name)}">
        ${escapeHtml(r.name)}
      </button>
    `;
  }).join("");

  container.innerHTML = html;

  container.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const name = e.currentTarget.getAttribute("data-name");
      const nowEnabled = isEnabledByFilter(name);
      setFilter(name, !nowEnabled);
      renderFilters();
      renderMenus();
    });
  });
}

function selectAll(enabled) {
  restaurantsList.forEach((r) => setFilter(r.name, enabled));
  renderFilters();
  renderMenus();
}

/* ===== DEFAULT PRO PRVNÍ NÁVŠTĚVU ===== */

function isFirstVisit() {
  return getCookie(COOKIE_VISITED) !== "1";
}

function markVisited() {
  setCookie(COOKIE_VISITED, "1", 365);
}

function setDefaultFirstVisitState() {
  // kalorie vypnout
  setCookie(COOKIE_CALORIES, "0", 365);

  // filtry: všechno false (nic vybrané)
  const filters = {};
  for (const r of restaurantsList) {
    if (r?.name) filters[String(r.name).toLowerCase()] = false;
  }
  saveFilters(filters);
}

/* ===== MENU CACHE (denní) ===== */

function readMenuCache(type) {
  const today = todayISO();

  const keyData = type === "all" ? LS_MENU_CACHE_ALL : LS_MENU_CACHE_TODAY;
  const keyDate = type === "all" ? LS_MENU_CACHE_DATE_ALL : LS_MENU_CACHE_DATE_TODAY;

  try {
    const cachedDate = localStorage.getItem(keyDate);
    if (cachedDate !== today) return null; // včerejší nebo starší → neplatná

    const raw = localStorage.getItem(keyData);
    if (!raw) return null;

    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function writeMenuCache(type, data) {
  const today = todayISO();
  const keyData = type === "all" ? LS_MENU_CACHE_ALL : LS_MENU_CACHE_TODAY;
  const keyDate = type === "all" ? LS_MENU_CACHE_DATE_ALL : LS_MENU_CACHE_DATE_TODAY;

  try {
    localStorage.setItem(keyData, JSON.stringify(data));
    localStorage.setItem(keyDate, today);
  } catch {
    // ignore (např. plné úložiště)
  }
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

  // první návštěva → defaulty
  if (isFirstVisit()) {
    setDefaultFirstVisitState();
    markVisited();
  } else {
    if (getCookie(COOKIE_CALORIES) === null) setCookie(COOKIE_CALORIES, "0", 365);
    if (getCookie(COOKIE_FILTERS) === null) saveFilters({});
  }

  updateCaloriesButton();
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
  // 1) zkus cache (platná jen pro dnešek)
  const cached = readMenuCache(type);
  if (cached) {
    menusCache = cached;
    renderMenus();
    return;
  }

  // 2) když není dnešní cache, stáhni z API a ulož
  const res = await fetch("/api/getMenus?type=" + encodeURIComponent(type));
  const data = await res.json();

  menusCache = Array.isArray(data) ? data : [];
  writeMenuCache(type, menusCache);

  renderMenus();
}

function renderMenus() {
  const container = document.getElementById("menuContainer");
  container.innerHTML = "";

  const filteredRestaurants = (menusCache || []).filter((r) => isEnabledByFilter(r.name));

  if (!filteredRestaurants.length) {
    container.innerHTML = `<div class="restaurant"><div class="small-muted">Vyber restauraci vlevo.</div></div>`;
    return;
  }

  filteredRestaurants.forEach((r) => {
    const div = document.createElement("div");
    div.className = "restaurant";
    div.innerHTML = `<h3>${escapeHtml(r.name)}</h3>`;

    (r.meals || []).forEach((m) => {
      const mealDiv = document.createElement("div");
      mealDiv.className = "meal";

      const price = m.price ? `${m.price} Kč` : "—";
      const day = m.day ? `(${m.day})` : "";

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
  await loadRestaurantsList();
  await loadToday();
})();