let restaurantsList = [];
let menusCache = [];
let currentType = "today";
let menuLoading = false;
let menuError = "";

const COOKIE_FILTERS = "menu03_filters";
const COOKIE_CALORIES = "menu03_calories";
const COOKIE_VISITED = "menu03_visited";

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
    if (p.startsWith(target)) return decodeURIComponent(p.substring(target.length));
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

/* ===== URL TYPY (PDF / OBRÁZEK) ===== */

function isPdfUrl(url) {
  return /\.pdf(\?|#|$)/i.test(String(url || ""));
}

function isImageUrl(url) {
  return /\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(String(url || ""));
}

/* ===== KALORIE (COOKIE) ===== */

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

function saveFilters(obj) {
  setCookie(COOKIE_FILTERS, JSON.stringify(obj || {}), 365);
}

function isEnabledByFilter(restaurantName) {
  const f = loadFilters();
  const key = String(restaurantName || "");
  if (!key) return false;

  // default: když filtr neexistuje, beru jako vypnuté (viz první návštěva, kde nastavujeme defaulty)
  if (!(key in f)) return false;
  return !!f[key];
}

function setFilter(restaurantName, enabled) {
  const f = loadFilters();
  f[String(restaurantName || "")] = !!enabled;
  saveFilters(f);
}

function hasAnySelected() {
  const f = loadFilters();
  return Object.values(f).some(Boolean);
}

function selectAll(enabled) {
  const f = loadFilters();
  restaurantsList.forEach(r => {
    const name = r?.name;
    if (name) f[name] = !!enabled;
  });
  saveFilters(f);
  renderFilters();
  renderMenus();
}

/* ===== FIRST VISIT ===== */

function isFirstVisit() {
  return getCookie(COOKIE_VISITED) !== "1";
}

function markVisited() {
  setCookie(COOKIE_VISITED, "1", 365);
}

function setDefaultFirstVisitState() {
  // 1) filtry: defaultně vše vypnuté (uživatel si vybere) – ale můžeš to změnit na true
  const f = {};
  restaurantsList.forEach(r => {
    if (r?.name) f[r.name] = false;
  });
  saveFilters(f);

  // 2) kalorie defaultně vypnuté
  setCookie(COOKIE_CALORIES, "0", 365);
}

/* ===== RESTAURACE LIST (API) ===== */

async function loadRestaurantsList() {
  try {
    const resp = await fetch("/api/restaurants");
    const data = await resp.json();
    restaurantsList = Array.isArray(data) ? data : [];
  } catch {
    restaurantsList = [];
  }

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

/* ===== FILTER UI ===== */

function renderFilters() {
  const container = document.getElementById("filterContainer");
  if (!container) return;

  container.innerHTML = "";

  const f = loadFilters();

  restaurantsList.forEach((r) => {
    const name = r?.name || "Neznámá";
    const btn = document.createElement("button");
    btn.className = "filter-btn";

    const enabled = !!f[name];
    if (enabled) btn.classList.add("active-green");

    btn.textContent = name;
    btn.onclick = () => {
      setFilter(name, !enabled);
      renderFilters();
      renderMenus();
    };

    container.appendChild(btn);
  });
}

/* ===== MENU CACHE (LOCALSTORAGE) ===== */

function getCacheKey(type) {
  return type === "all" ? LS_MENU_CACHE_ALL : LS_MENU_CACHE_TODAY;
}
function getDateKey(type) {
  return type === "all" ? LS_MENU_CACHE_DATE_ALL : LS_MENU_CACHE_DATE_TODAY;
}

function loadLocalCache(type) {
  try {
    const raw = localStorage.getItem(getCacheKey(type));
    const date = localStorage.getItem(getDateKey(type));
    if (!raw || !date) return null;

    // today cache jen pro dnešek
    if (type === "today" && date !== todayISO()) return null;

    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function saveLocalCache(type, data) {
  try {
    localStorage.setItem(getCacheKey(type), JSON.stringify(data || []));
    localStorage.setItem(getDateKey(type), type === "today" ? todayISO() : todayISO());
  } catch {
    // ignore
  }
}

/* ===== LOAD MENUS (API) ===== */

async function loadMenus(type) {
  currentType = type;
  menuLoading = true;
  menuError = "";
  renderMenus();

  // 1) zkusit local cache
  const cached = loadLocalCache(type);
  if (cached) {
    menusCache = cached;
    menuLoading = false;
    renderMenus();
    return;
  }

  // 2) fetch
  try {
    const resp = await fetch("/api/getMenus?type=" + encodeURIComponent(type));
    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error("API vrátilo neočekávaný formát");
    menusCache = data;
    saveLocalCache(type, data);
  } catch (e) {
    menuError = String(e?.message || e);
    menusCache = [];
  } finally {
    menuLoading = false;
    renderMenus();
  }
}

async function loadToday() {
  await loadMenus("today");
}

async function loadAll() {
  await loadMenus("all");
}

/* ===== RENDER MENUS ===== */

function renderMenus() {
  const container = document.getElementById("menuContainer");
  if (!container) return;

  container.innerHTML = "";

  if (menuLoading) {
    container.innerHTML = `<div class="restaurant"><div class="small-muted">Načítám menu…</div></div>`;
    return;
  }

  if (menuError) {
    container.innerHTML = `<div class="restaurant"><div class="small-muted"><b>Chyba načítání menu:</b><br>${escapeHtml(menuError)}</div></div>`;
    return;
  }

  if (!menusCache || menusCache.length === 0) {
    if (hasAnySelected()) {
      container.innerHTML = `<div class="restaurant"><div class="small-muted">Menu se nepodařilo načíst. Zkus obnovit stránku.</div></div>`;
    } else {
      container.innerHTML = `<div class="restaurant"><div class="small-muted">Vyber restauraci vlevo.</div></div>`;
    }
    return;
  }

  const filteredRestaurants = menusCache.filter(r => isEnabledByFilter(r.name));

  if (!filteredRestaurants.length) {
    container.innerHTML = `<div class="restaurant"><div class="small-muted">Vyber restauraci vlevo.</div></div>`;
    return;
  }

  filteredRestaurants.forEach((r) => {
    const div = document.createElement("div");
    div.className = "restaurant";
    div.innerHTML = `<h3>${escapeHtml(r.name)}</h3>`;

    // zdroj / PDF
    if (r.url) {
      const url = String(r.url);
      const links = document.createElement("div");
      links.className = "small-muted";

      if (isPdfUrl(url)) {
        links.innerHTML = `Zdroj: <a href="${escapeHtmlAttr(url)}" target="_blank" rel="noopener noreferrer">Otevřít PDF</a>`;
        div.appendChild(links);

        // pokus o náhled – některé weby to mohou blokovat (X-Frame-Options / CSP)
        const wrap = document.createElement("div");
        wrap.className = "pdf-wrap";
        wrap.innerHTML = `
          <iframe class="pdf-frame" src="${escapeHtmlAttr(url)}"></iframe>
          <div class="small-muted">Pokud se náhled nezobrazí, použij odkaz „Otevřít PDF“ výše.</div>
        `;
        div.appendChild(wrap);
      } else if (isImageUrl(url)) {
        links.innerHTML = `Zdroj: <a href="${escapeHtmlAttr(url)}" target="_blank" rel="noopener noreferrer">Otevřít obrázek</a>`;
        div.appendChild(links);

        const img = document.createElement("img");
        img.className = "menu-image";
        img.src = url;
        img.alt = `Menu – ${r.name}`;
        div.appendChild(img);
      } else {
        links.innerHTML = `Zdroj: <a href="${escapeHtmlAttr(url)}" target="_blank" rel="noopener noreferrer">otevřít</a>`;
        div.appendChild(links);
      }
    }

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