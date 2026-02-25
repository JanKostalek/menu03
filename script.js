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

/* ===== URL TYPY + SOURCE BLOK ===== */

function isPdfUrl(url) {
  return /\.pdf(\?|#|$)/i.test(String(url || ""));
}

function isImageUrl(url) {
  return /\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(String(url || ""));
}

function iconExternal() {
  // jednoduchá ikona "otevřít v novém okně"
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z"></path><path d="M5 5h6v2H7v10h10v-4h2v6H5V5z"></path></svg>`;
}

function iconEye() {
  // ikona "náhled"
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c5.05 0 9.27 3.11 11 7-1.73 3.89-5.95 7-11 7S2.73 15.89 1 12c1.73-3.89 5.95-7 11-7zm0 2c-3.94 0-7.32 2.2-8.94 5 1.62 2.8 5 5 8.94 5s7.32-2.2 8.94-5c-1.62-2.8-5-5-8.94-5zm0 2.5A2.5 2.5 0 1 1 12 14a2.5 2.5 0 0 1 0-5z"></path></svg>`;
}

function buildSourceBlock(url, previewId) {
  const wrap = document.createElement("div");
  wrap.className = "source-block";

  // PDF
  if (isPdfUrl(url)) {
    wrap.innerHTML = `
      <div class="source-actions">
        <a class="btn-action btn-pdf" href="${escapeHtmlAttr(url)}" target="_blank" rel="noopener noreferrer">
          ${iconExternal()} <span>Otevřít PDF</span>
        </a>

        <button type="button" class="btn-action btn-secondary" data-toggle-preview="${escapeHtmlAttr(previewId)}">
          ${iconEye()} <span>Zobrazit náhled</span>
        </button>
      </div>

      <div class="source-note">
        Náhled PDF bývá některými weby blokován. Když se nezobrazí, použij tlačítko <b>Otevřít PDF</b>.
      </div>

      <div id="${escapeHtmlAttr(previewId)}" class="pdf-wrap">
        <iframe class="pdf-frame" src="${escapeHtmlAttr(url)}"></iframe>
      </div>
    `;
    return wrap;
  }

  // Obrázek
  if (isImageUrl(url)) {
    wrap.innerHTML = `
      <div class="source-actions">
        <a class="btn-action btn-img" href="${escapeHtmlAttr(url)}" target="_blank" rel="noopener noreferrer">
          ${iconExternal()} <span>Otevřít obrázek</span>
        </a>

        <button type="button" class="btn-action btn-secondary" data-toggle-preview="${escapeHtmlAttr(previewId)}">
          ${iconEye()} <span>Zobrazit náhled</span>
        </button>
      </div>

      <div id="${escapeHtmlAttr(previewId)}" class="img-wrap">
        <img class="menu-image" src="${escapeHtmlAttr(url)}" alt="Menu" />
      </div>
    `;
    return wrap;
  }

  // Jiné URL
  wrap.innerHTML = `
    <div class="source-actions">
      <a class="btn-action" href="${escapeHtmlAttr(url)}" target="_blank" rel="noopener noreferrer">
        ${iconExternal()} <span>Otevřít zdroj</span>
      </a>
    </div>
  `;
  return wrap;
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
  return filters[key] === true;
}

function hasAnySelected() {
  const f = loadFilters();
  return Object.values(f).some(v => v === true);
}

/* ===== UI: FILTRY ===== */

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
    return `<button type="button" class="${cls}" data-name="${escapeHtmlAttr(r.name)}">${escapeHtml(r.name)}</button>`;
  }).join("");

  container.innerHTML = html;

  container.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const name = e.currentTarget.getAttribute("data-name");
      const nowEnabled = isEnabledByFilter(name);
      setFilter(name, !nowEnabled);

      renderFilters();
      renderMenus();

      if (!menuLoading && (!menusCache || menusCache.length === 0)) {
        await loadMenus(currentType);
      }
    });
  });
}

function selectAll(enabled) {
  restaurantsList.forEach((r) => setFilter(r.name, enabled));
  renderFilters();
  renderMenus();

  if (!menuLoading && (!menusCache || menusCache.length === 0)) {
    loadMenus(currentType);
  }
}

/* ===== DEFAULT PRO PRVNÍ NÁVŠTĚVU ===== */

function isFirstVisit() {
  return getCookie(COOKIE_VISITED) !== "1";
}

function markVisited() {
  setCookie(COOKIE_VISITED, "1", 365);
}

function setDefaultFirstVisitState() {
  const f = {};
  restaurantsList.forEach(r => {
    if (r?.name) f[String(r.name).toLowerCase()] = false;
  });
  saveFilters(f);

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

  const cached = loadLocalCache(type);
  if (cached) {
    menusCache = cached;
    menuLoading = false;
    renderMenus();
    return;
  }

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

  filteredRestaurants.forEach((r, idx) => {
    const div = document.createElement("div");
    div.className = "restaurant";
    div.innerHTML = `<h3>${escapeHtml(r.name)}</h3>`;

    // ===== Zdroj (URL) + PDF/obrázek náhled =====
    if (r.url) {
      const url = String(r.url);
      div.appendChild(buildSourceBlock(url, `preview_${idx}`));
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

  // eventy pro "Zobrazit náhled"
  container.querySelectorAll("[data-toggle-preview]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const targetId = e.currentTarget.getAttribute("data-toggle-preview");
      const wrap = document.getElementById(targetId);
      if (!wrap) return;

      const isOpen = wrap.classList.toggle("is-open");
      const span = e.currentTarget.querySelector("span");
      if (span) span.textContent = isOpen ? "Skrýt náhled" : "Zobrazit náhled";
    });
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