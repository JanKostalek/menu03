let restaurantsList = [];
let menusCache = [];
let currentType = "today";

const LS_KEY = "menu03:filters";
const LS_CALORIES = "menu03:caloriesEnabled";
const LS_KCAL_CACHE = "menu03:kcalCache_v1"; // { "normalized meal": number|null }

/* ===== KALORIE TOGGLE ===== */

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
  if (caloriesEnabled()) {
    enrichCaloriesForVisibleMeals(); // start skutečné načítání
  }
}

function updateCaloriesButton() {
  const btn = document.getElementById("btnCalories");
  if (!btn) return;

  if (caloriesEnabled()) btn.classList.add("active");
  else btn.classList.remove("active");
}

/* ===== KALORIE CACHE + FETCH ===== */

function loadKcalCache() {
  try {
    const raw = localStorage.getItem(LS_KCAL_CACHE);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function saveKcalCache(cache) {
  try {
    localStorage.setItem(LS_KCAL_CACHE, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

function normMealName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function shouldTryCaloriesForMealName(name) {
  const n = normMealName(name);
  if (!n || n.length < 5) return false;

  // odfiltruj zjevné nadpisy/sekce
  const bad = [
    "menu", "nabídka", "nabidka", "polévky", "polevky", "saláty", "salaty",
    "dezerty", "nápoje", "napoje", "stálá", "stala", "denní", "denni",
    "lunch menu", "starters", "soups", "gallery", "galerie"
  ];
  if (bad.some(b => n === b || n.includes(b + " ") || n.endsWith(" " + b))) return false;

  // telefon / čistě čísla
  if (/^\+?\d[\d\s-]{6,}$/.test(n)) return false;

  return true;
}

// jednoduchý limiter na paralelní požadavky
async function runWithConcurrency(tasks, concurrency = 3) {
  let i = 0;
  const workers = new Array(concurrency).fill(0).map(async () => {
    while (i < tasks.length) {
      const idx = i++;
      try { await tasks[idx](); } catch { /* ignore */ }
    }
  });
  await Promise.all(workers);
}

async function fetchKcalFromApi(mealName) {
  const q = normMealName(mealName);
  const resp = await fetch("/api/usda?query=" + encodeURIComponent(q));
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return null;
  // data.kcal může být number nebo null
  return (typeof data.kcal === "number") ? data.kcal : null;
}

async function enrichCaloriesForVisibleMeals() {
  if (!caloriesEnabled()) return;

  const kcalCache = loadKcalCache();

  // vezmeme jen viditelné restaurace podle filtru
  const visibleRestaurants = (menusCache || []).filter(r => isEnabledByFilter(r.name));

  // sebereme kandidáty (unikátní názvy)
  const needed = new Set();

  for (const r of visibleRestaurants) {
    for (const m of (r.meals || [])) {
      if (!m || !m.name) continue;
      if (!shouldTryCaloriesForMealName(m.name)) continue;

      const key = normMealName(m.name);
      if (!(key in kcalCache)) needed.add(key);
    }
  }

  if (needed.size === 0) {
    // už vše máme (nebo je to nevhodné)
    applyKcalCacheToMenus(kcalCache);
    renderMenus();
    return;
  }

  const tasks = Array.from(needed).map((key) => async () => {
    // ještě jednou check (kdyby se to změnilo během běhu)
    const cacheNow = loadKcalCache();
    if (key in cacheNow) return;

    const kcal = await fetchKcalFromApi(key);

    // uložit do localStorage cache
    const cache = loadKcalCache();
    cache[key] = kcal; // může být null
    saveKcalCache(cache);

    // průběžně aplikovat do UI
    applyKcalCacheToMenus(cache);
    renderMenus();
  });

  // max 3 paralelně
  await runWithConcurrency(tasks, 3);
}

function applyKcalCacheToMenus(kcalCache) {
  for (const r of (menusCache || [])) {
    for (const m of (r.meals || [])) {
      if (!m || !m.name) continue;
      const key = normMealName(m.name);
      if (key in kcalCache) {
        m.calories = kcalCache[key]; // number nebo null
      }
    }
  }
}

/* ===== FILTRY ===== */

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

      // pokud jsou kalorie zapnuté, dopočítej pro nové viditelné položky
      if (caloriesEnabled()) enrichCaloriesForVisibleMeals();
    });
  });
}

function selectAll(enabled) {
  restaurantsList.forEach(r => setFilter(r.name, enabled));
  renderFilters();
  renderMenus();
  if (caloriesEnabled()) enrichCaloriesForVisibleMeals();
}

/* ===== NAČÍTÁNÍ MENU ===== */

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

  // aplikuj případnou lokální cache kcal do načtených dat
  applyKcalCacheToMenus(loadKcalCache());

  renderMenus();

  // pokud je zapnuto, startni načítání z API
  if (caloriesEnabled()) enrichCaloriesForVisibleMeals();
}

function renderMenus() {
  const container = document.getElementById("menuContainer");
  container.innerHTML = "";

  const filteredRestaurants = menusCache.filter(r => isEnabledByFilter(r.name));

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

      let calorieLine = "";
      if (caloriesEnabled()) {
        // pokud je null => nenalezeno, pokud undefined => ještě se nenačetlo
        if (typeof m.calories === "number") {
          calorieLine = ` | 🔥 ${escapeHtml(String(m.calories))} kcal`;
        } else if (m.calories === null) {
          calorieLine = ` | 🔥 ? kcal`;
        } else {
          calorieLine = ` | 🔥 …`;
        }
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

function openAdmin() {
  window.location.href = "/admin.html";
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