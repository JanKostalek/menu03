let restaurantsList = [];
let menusCache = [];
let currentType = "today";
let menuLoading = false;
let menuError = "";

const COOKIE_FILTERS = "menu03_filters";
const COOKIE_VISITED = "menu03_visited";

const LS_MENU_CACHE_TODAY = "menu03_menu_cache_today";
const LS_MENU_CACHE_ALL = "menu03_menu_cache_all";
const LS_MENU_CACHE_DATE_TODAY = "menu03_menu_cache_date_today";
const LS_MENU_CACHE_DATE_ALL = "menu03_menu_cache_date_all";

const LS_LAST_REFRESH = "menu03_last_refresh";

const LS_RESTAURANTS_CACHE = "menu03_restaurants_cache";
const LS_RESTAURANTS_CACHE_DATE = "menu03_restaurants_cache_date";

const LS_MENUS_UPDATED_AT = "menu03_menus_updated_at";
const LS_RESTAURANTS_UPDATED_AT = "menu03_restaurants_updated_at";

const DEFAULT_MENU_URL_TODAY = "/api/getMenus?type=today";
const DEFAULT_MENU_URL_ALL = "/api/getMenus?type=all";

const DAY_MS = 24 * 60 * 60 * 1000;

const buttonToday = document.getElementById("btnToday");
const buttonAll = document.getElementById("btnAll");
const menuContainer = document.getElementById("menuContainer");
const menuErrorEl = document.getElementById("menuError");
const menuLoadingEl = document.getElementById("menuLoading");

const filtersContainer = document.getElementById("filtersContainer");
const filtersTitle = document.getElementById("filtersTitle");
const filtersListEl = document.getElementById("filtersList");
const filtersClearBtn = document.getElementById("filtersClearBtn");
const filtersToggleBtn = document.getElementById("filtersToggleBtn");

const adminBtn = document.getElementById("adminBtn");
const suggestBtn = document.getElementById("suggestBtn");

function setCookie(name, value, days) {
  const d = new Date();
  d.setTime(d.getTime() + days * DAY_MS);
  const expires = "expires=" + d.toUTCString();
  document.cookie =
    name + "=" + encodeURIComponent(value) + ";" + expires + ";path=/";
}

function getCookie(name) {
  const decodedCookie = decodeURIComponent(document.cookie);
  const ca = decodedCookie.split(";");
  name = name + "=";
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === " ") c = c.substring(1);
    if (c.indexOf(name) === 0) return c.substring(name.length, c.length);
  }
  return "";
}

function deleteCookie(name) {
  document.cookie =
    name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

function saveFiltersToCookie(filtersObj) {
  setCookie(COOKIE_FILTERS, JSON.stringify(filtersObj), 365);
}

function loadFiltersFromCookie() {
  const str = getCookie(COOKIE_FILTERS);
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

function markVisited() {
  setCookie(COOKIE_VISITED, "1", 365);
}

function hasVisited() {
  return getCookie(COOKIE_VISITED) === "1";
}

function escapeHtml(str) {
  if (typeof str !== "string") return str;
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setLoading(isLoading) {
  menuLoading = isLoading;
  if (menuLoadingEl) menuLoadingEl.style.display = isLoading ? "block" : "none";
}

function setError(msg) {
  menuError = msg || "";
  if (menuErrorEl) {
    menuErrorEl.textContent = menuError;
    menuErrorEl.style.display = menuError ? "block" : "none";
  }
}

function setActiveType(type) {
  currentType = type;
  if (buttonToday) buttonToday.classList.toggle("active", type === "today");
  if (buttonAll) buttonAll.classList.toggle("active", type === "all");
}

function formatRestaurantName(r) {
  return r?.name || "";
}

function normalizeText(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function unique(arr) {
  return Array.from(new Set(arr));
}

function getFiltersFromUI() {
  const filters = {};
  const checkboxes = filtersListEl
    ? filtersListEl.querySelectorAll('input[type="checkbox"][data-filter]')
    : [];
  checkboxes.forEach((cb) => {
    const key = cb.getAttribute("data-filter");
    if (!key) return;
    if (!filters[key]) filters[key] = [];
    if (cb.checked) filters[key].push(cb.value);
  });
  return filters;
}

function applyFiltersToRestaurants(restaurants) {
  const filters = getFiltersFromUI();
  const keys = Object.keys(filters);
  if (!keys.length) return restaurants;

  return restaurants.filter((r) => {
    for (const key of keys) {
      const selected = filters[key] || [];
      if (!selected.length) continue;

      const value = r[key];
      if (Array.isArray(value)) {
        const normVals = value.map(normalizeText);
        const ok = selected.some((s) => normVals.includes(normalizeText(s)));
        if (!ok) return false;
      } else {
        const ok = selected
          .map(normalizeText)
          .includes(normalizeText(value));
        if (!ok) return false;
      }
    }
    return true;
  });
}

function buildFilters(restaurants) {
  if (!filtersListEl) return;

  const filterDefs = [
    { key: "category", label: "Kategorie" },
    { key: "area", label: "Oblast" },
    { key: "tags", label: "Tagy" },
  ];

  const saved = loadFiltersFromCookie();

  filtersListEl.innerHTML = "";

  filterDefs.forEach((def) => {
    const values = [];
    restaurants.forEach((r) => {
      const v = r[def.key];
      if (!v) return;
      if (Array.isArray(v)) values.push(...v);
      else values.push(v);
    });

    const uniq = unique(values.filter(Boolean));
    if (!uniq.length) return;

    const group = document.createElement("div");
    group.className = "filterGroup";

    const title = document.createElement("div");
    title.className = "filterGroupTitle";
    title.textContent = def.label;
    group.appendChild(title);

    uniq
      .sort((a, b) => normalizeText(a).localeCompare(normalizeText(b)))
      .forEach((val) => {
        const id = `f_${def.key}_${normalizeText(val).replaceAll(" ", "_")}`;

        const row = document.createElement("label");
        row.className = "filterRow";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = id;
        cb.value = val;
        cb.setAttribute("data-filter", def.key);

        if (
          saved?.[def.key] &&
          Array.isArray(saved[def.key]) &&
          saved[def.key].map(normalizeText).includes(normalizeText(val))
        ) {
          cb.checked = true;
        }

        cb.addEventListener("change", () => {
          saveFiltersToCookie(getFiltersFromUI());
          render();
        });

        const span = document.createElement("span");
        span.textContent = val;

        row.appendChild(cb);
        row.appendChild(span);

        group.appendChild(row);
      });

    filtersListEl.appendChild(group);
  });

  if (filtersClearBtn) {
    filtersClearBtn.onclick = () => {
      deleteCookie(COOKIE_FILTERS);
      buildFilters(restaurantsList);
      render();
    };
  }

  if (filtersToggleBtn) {
    filtersToggleBtn.onclick = () => {
      const expanded =
        filtersContainer?.classList.toggle("expanded") ?? false;
      if (filtersToggleBtn)
        filtersToggleBtn.textContent = expanded ? "Skrýt filtry" : "Filtry";
    };
  }
}

async function fetchRestaurants() {
  // server + cache buster
  const url = "/api/restaurants";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Nelze načíst seznam restaurací.");
  const json = await res.json();

  if (!Array.isArray(json.restaurants)) return [];

  // store updatedAt to localStorage (for debugging / cache decisions)
  if (json.updatedAt) {
    localStorage.setItem(LS_RESTAURANTS_UPDATED_AT, String(json.updatedAt));
  }

  return json.restaurants;
}

async function fetchMenus(type) {
  const url = type === "all" ? DEFAULT_MENU_URL_ALL : DEFAULT_MENU_URL_TODAY;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Nelze načíst menu.");
  const json = await res.json();

  if (json.updatedAt) {
    localStorage.setItem(LS_MENUS_UPDATED_AT, String(json.updatedAt));
  }

  return json.menus || [];
}

function getLocalMenuCacheKey(type) {
  return type === "all" ? LS_MENU_CACHE_ALL : LS_MENU_CACHE_TODAY;
}

function getLocalMenuCacheDateKey(type) {
  return type === "all" ? LS_MENU_CACHE_DATE_ALL : LS_MENU_CACHE_DATE_TODAY;
}

function loadMenusFromLocalCache(type) {
  try {
    const key = getLocalMenuCacheKey(type);
    const dateKey = getLocalMenuCacheDateKey(type);
    const cached = localStorage.getItem(key);
    const cachedDate = localStorage.getItem(dateKey);

    if (!cached || !cachedDate) return null;

    const parsed = JSON.parse(cached);
    const date = Number(cachedDate);

    if (!Array.isArray(parsed)) return null;

    // simple TTL: 6 hours
    if (Date.now() - date > 6 * 60 * 60 * 1000) return null;

    return parsed;
  } catch {
    return null;
  }
}

function saveMenusToLocalCache(type, menus) {
  try {
    const key = getLocalMenuCacheKey(type);
    const dateKey = getLocalMenuCacheDateKey(type);
    localStorage.setItem(key, JSON.stringify(menus || []));
    localStorage.setItem(dateKey, String(Date.now()));
  } catch {}
}

function clearMenusLocalCache() {
  try {
    localStorage.removeItem(LS_MENU_CACHE_TODAY);
    localStorage.removeItem(LS_MENU_CACHE_ALL);
    localStorage.removeItem(LS_MENU_CACHE_DATE_TODAY);
    localStorage.removeItem(LS_MENU_CACHE_DATE_ALL);
  } catch {}
}

function groupMenusByRestaurant(menus) {
  const byId = {};
  (menus || []).forEach((m) => {
    const id = m.restaurantId;
    if (!id) return;
    if (!byId[id]) byId[id] = [];
    byId[id].push(m);
  });
  return byId;
}

function buildMenuCard(restaurant, items) {
  const card = document.createElement("div");
  card.className = "menuCard";

  const header = document.createElement("div");
  header.className = "menuCardHeader";

  const h3 = document.createElement("h3");
  h3.textContent = formatRestaurantName(restaurant);

  const meta = document.createElement("div");
  meta.className = "menuMeta";

  if (restaurant?.area) {
    const span = document.createElement("span");
    span.textContent = restaurant.area;
    meta.appendChild(span);
  }

  if (restaurant?.category) {
    const span = document.createElement("span");
    span.textContent = restaurant.category;
    meta.appendChild(span);
  }

  header.appendChild(h3);
  header.appendChild(meta);

  const body = document.createElement("div");
  body.className = "menuCardBody";

  if (restaurant?.mode === "embed" && restaurant?.url) {
    const row = document.createElement("div");
    row.className = "menuRow";

    const a = document.createElement("a");
    a.href = restaurant.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Otevřít menu (zdroj)";
    row.appendChild(a);

    const btn = document.createElement("button");
    btn.className = "btnSmall";
    btn.textContent = "Zobrazit v aplikaci";
    btn.onclick = () => openViewer(restaurant.url, restaurant.name || "Menu");
    row.appendChild(btn);

    body.appendChild(row);
  } else {
    // parse mode
    if (!items || !items.length) {
      const empty = document.createElement("div");
      empty.className = "menuEmpty";
      empty.textContent = "Žádné položky.";
      body.appendChild(empty);
    } else {
      items.forEach((it) => {
        const row = document.createElement("div");
        row.className = "menuRow";

        const name = document.createElement("div");
        name.className = "menuItemName";
        name.innerHTML = escapeHtml(it.name || "");

        const price = document.createElement("div");
        price.className = "menuItemPrice";
        price.innerHTML = escapeHtml(it.price || "");

        row.appendChild(name);
        row.appendChild(price);

        body.appendChild(row);
      });
    }

    if (restaurant?.url) {
      const row = document.createElement("div");
      row.className = "menuRow menuRowLink";

      const a = document.createElement("a");
      a.href = restaurant.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Zdroj";
      row.appendChild(a);

      const btn = document.createElement("button");
      btn.className = "btnSmall";
      btn.textContent = "Otevřít v okně";
      btn.onclick = () => openViewer(restaurant.url, restaurant.name || "Menu");
      row.appendChild(btn);

      body.appendChild(row);
    }
  }

  card.appendChild(header);
  card.appendChild(body);

  return card;
}

function openViewer(url, title) {
  try {
    const w = 1024;
    const h = 720;
    const left = Math.max(0, (window.screen.width - w) / 2);
    const top = Math.max(0, (window.screen.height - h) / 2);
    const features = `popup=yes,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=${w},height=${h},left=${left},top=${top}`;
    const win = window.open(
      `/viewer.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(
        title || "Menu"
      )}`,
      "_blank",
      features
    );
    if (!win) {
      window.open(url, "_blank", "noopener");
    }
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

async function loadDataAndRender() {
  setError("");
  setLoading(true);

  try {
    restaurantsList = await fetchRestaurants();

    // build filters once restaurants loaded
    buildFilters(restaurantsList);

    // local cache first for menus
    const cached = loadMenusFromLocalCache(currentType);
    if (cached) {
      menusCache = cached;
    } else {
      menusCache = await fetchMenus(currentType);
      saveMenusToLocalCache(currentType, menusCache);
    }

    render();

    // background refresh once per 10 minutes
    const lastRefresh = Number(localStorage.getItem(LS_LAST_REFRESH) || "0");
    if (Date.now() - lastRefresh > 10 * 60 * 1000) {
      localStorage.setItem(LS_LAST_REFRESH, String(Date.now()));
      refreshInBackground();
    }
  } catch (e) {
    setError(e?.message || "Došlo k chybě.");
  } finally {
    setLoading(false);
  }
}

async function refreshInBackground() {
  try {
    const freshMenus = await fetchMenus(currentType);
    menusCache = freshMenus;
    saveMenusToLocalCache(currentType, menusCache);
    render();
  } catch {}
}

function render() {
  if (!menuContainer) return;

  const restaurantsFiltered = applyFiltersToRestaurants(restaurantsList);

  const menusByRestaurant = groupMenusByRestaurant(menusCache);

  menuContainer.innerHTML = "";

  restaurantsFiltered
    .sort((a, b) =>
      normalizeText(a.name).localeCompare(normalizeText(b.name))
    )
    .forEach((r) => {
      const items = menusByRestaurant[r.id] || [];
      const card = buildMenuCard(r, items);
      menuContainer.appendChild(card);
    });

  if (!hasVisited()) {
    markVisited();
    // optionally expand filters on first visit
    // filtersContainer?.classList.add("expanded");
  }
}

function onTypeClick(type) {
  if (menuLoading) return;
  setActiveType(type);

  // load from cache or fetch
  const cached = loadMenusFromLocalCache(currentType);
  if (cached) {
    menusCache = cached;
    render();
  } else {
    loadDataAndRender();
  }
}

/* ===== ADMIN / SUGGEST ===== */

function openAdmin() {
  window.location.href = "/admin.html";
}

function openSuggestion() {
  window.location.href = "/suggest.html";
}

/* ===== INIT ===== */

if (buttonToday) buttonToday.addEventListener("click", () => onTypeClick("today"));
if (buttonAll) buttonAll.addEventListener("click", () => onTypeClick("all"));

if (adminBtn) adminBtn.addEventListener("click", openAdmin);
if (suggestBtn) suggestBtn.addEventListener("click", openSuggestion);

setActiveType(currentType);
loadDataAndRender();