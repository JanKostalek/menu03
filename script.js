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

/**
 * Domény, které typicky blokují vložení do iframe (X-Frame-Options / CSP).
 * Sem si můžeš postupně přidávat další problematické domény.
 */
const EMBED_BLOCKED_DOMAINS = [
  "holidayinn.cz",
  // přidej další dle potřeby:
  // "restauracesalanda.cz",
];

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

/* ===== URL HELPERS ===== */

function isPdfUrl(url) {
  return /\.pdf(\?|#|$)/i.test(String(url || ""));
}

function isImageUrl(url) {
  return /\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(String(url || ""));
}

function getHostname(url) {
  try {
    return new URL(String(url), window.location.origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isEmbedBlocked(url) {
  const host = getHostname(url);
  if (!host) return false;

  return EMBED_BLOCKED_DOMAINS.some((d) => {
    const dom = String(d).toLowerCase();
    return host === dom || host.endsWith("." + dom);
  });
}

/* ===== POPUP OPEN ===== */

function openPopup(url) {
  const w = Math.min(1200, window.screen.width - 60);
  const h = Math.min(900, window.screen.height - 80);
  const left = Math.max(0, Math.floor((window.screen.width - w) / 2));
  const top = Math.max(0, Math.floor((window.screen.height - h) / 2));

  const features =
    `popup=yes,` +
    `width=${w},height=${h},left=${left},top=${top},` +
    `toolbar=no,menubar=no,location=no,status=no,` +
    `scrollbars=yes,resizable=yes`;

  const win = window.open(url, "menu_popup", features);
  if (!win) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  win.opener = null;
  win.focus();
}

/* ===== UI ICONS ===== */

function iconExternal() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z"></path><path d="M5 5h6v2H7v10h10v-4h2v6H5V5z"></path></svg>`;
}

/* ===== SOURCE BLOCK ===== */

function buildPdfBlock(url) {
  const wrap = document.createElement("div");
  wrap.className = "source-block";

  const blocked = isEmbedBlocked(url);

  wrap.innerHTML = `
    <div class="source-actions">
      <button type="button" class="btn-action js-open-popup" data-url="${escapeHtmlAttr(url)}">
        ${iconExternal()} <span>Otevřít PDF</span>
      </button>
    </div>

    ${
      blocked
        ? `<div class="source-note source-note--warn">
             Otevření menu je blokováno zdrojovou stránkou. Použijte prosím tlačítko výše k jeho otevření.
           </div>`
        : `<div class="source-note">
             Pokud se náhled nezobrazí, použijte tlačítko <b>Otevřít PDF</b> výše.
           </div>
           <div class="pdf-wrap">
             <iframe class="pdf-frame" src="${escapeHtmlAttr(url)}"></iframe>
           </div>`
    }
  `;
  return wrap;
}

function buildImageBlock(url) {
  const wrap = document.createElement("div");
  wrap.className = "source-block";

  wrap.innerHTML = `
    <div class="source-actions">
      <a class="btn-action" href="${escapeHtmlAttr(url)}" target="_blank" rel="noopener noreferrer">
        ${iconExternal()} <span>Otevřít obrázek</span>
      </a>
    </div>

    <div class="img-wrap">
      <img class="menu-image" src="${escapeHtmlAttr(url)}" alt="Menu" />
    </div>
  `;
  return wrap;
}

/**
 * HTML/WEB zdroj – hybrid:
 * - pokud mode=embed → pokus o iframe, jinak varování + tlačítko
 * - pokud mode=parse → jen tlačítko (aby UI nebylo přeplněné), iframe jen když chceš (lze snadno změnit)
 */
function buildWebBlock(url, mode) {
  const wrap = document.createElement("div");
  wrap.className = "source-block";

  const blocked = isEmbedBlocked(url);

  // vždy nabízíme tlačítko
  let inner = `
    <div class="source-actions">
      <button type="button" class="btn-action js-open-popup" data-url="${escapeHtmlAttr(url)}">
        ${iconExternal()} <span>Otevřít zdroj</span>
      </button>
    </div>
  `;

  // embed režim → snažíme se vložit stránku do iframe (stejně jako PDF)
  if (String(mode || "").toLowerCase() === "embed") {
    if (blocked) {
      inner += `
        <div class="source-note source-note--warn">
          Otevření menu je blokováno zdrojovou stránkou. Použijte prosím tlačítko výše k jeho otevření.
        </div>
      `;
    } else {
      inner += `
        <div class="source-note">
          Pokud se náhled nezobrazí, použijte tlačítko <b>Otevřít zdroj</b> výše.
        </div>
        <div class="web-wrap">
          <iframe class="web-frame" src="${escapeHtmlAttr(url)}"></iframe>
        </div>
      `;
    }
  }

  wrap.innerHTML = inner;
  return wrap;
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
    if (getCookie(COOKIE_FILTERS) === null) saveFilters({});
  }

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
    localStorage.setItem(getDateKey(type), todayISO());
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

  filteredRestaurants.forEach((r) => {
    const div = document.createElement("div");
    div.className = "restaurant";
    div.innerHTML = `<h3>${escapeHtml(r.name)}</h3>`;

    const url = r.url ? String(r.url) : "";
    const mode = String(r.mode || "parse").toLowerCase();

    if (url) {
      if (isPdfUrl(url)) div.appendChild(buildPdfBlock(url));
      else if (isImageUrl(url)) div.appendChild(buildImageBlock(url));
      else div.appendChild(buildWebBlock(url, mode));
    }

    // Parsovaná jídla se zobrazí jen když existují
    const meals = Array.isArray(r.meals) ? r.meals : [];
    if (meals.length) {
      meals.forEach((m) => {
        const mealDiv = document.createElement("div");
        mealDiv.className = "meal";

        const price = m.price ? `${m.price} Kč` : "—";
        const day = m.day ? `(${m.day})` : "";

        mealDiv.innerHTML = `
          <div><b>${escapeHtml(m.name)}</b> ${escapeHtml(day)}</div>
          <div>💰 ${escapeHtml(price)}</div>
          <hr>
        `;

        div.appendChild(mealDiv);
      });
    }

    // když je mode=parse a nic se nenašlo, necháme UI čisté (jen zdrojový embed/tlačítko)
    container.appendChild(div);
  });

  // popup tlačítka (PDF i web)
  container.querySelectorAll(".js-open-popup").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const url = e.currentTarget.getAttribute("data-url");
      if (!url) return;
      openPopup(url);
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