// menu03 - client

const els = {
  btnToday: document.getElementById("btnToday"),
  btnAll: document.getElementById("btnAll"),
  btnAdmin: document.getElementById("btnAdmin"),
  btnSuggest: document.getElementById("btnSuggest"),
  btnReloadRestaurants: document.getElementById("btnReloadRestaurants"),

  restaurantsList: document.getElementById("restaurantsList"),
  restaurantsMeta: document.getElementById("restaurantsMeta"),

  selectedRestaurantName: document.getElementById("selectedRestaurantName"),
  selectedRestaurantSub: document.getElementById("selectedRestaurantSub"),
  sourceLink: document.getElementById("sourceLink"),

  menuContainer: document.getElementById("menuContainer"),
};

const LS_MENU_CACHE_TODAY = "menu03_menu_cache_today";
const LS_MENU_CACHE_ALL = "menu03_menu_cache_all";
const LS_MENU_CACHE_DATE_TODAY = "menu03_menu_cache_date_today";
const LS_MENU_CACHE_DATE_ALL = "menu03_menu_cache_date_all";
const LS_RESTAURANTS_SIG = "menu03_restaurants_sig";

let state = {
  mode: "today", // "today" | "all"
  restaurants: [],
  selectedId: null,
};

init();

/* =========================
   INIT
========================= */

function init() {
  els.btnToday?.addEventListener("click", () => setMode("today"));
  els.btnAll?.addEventListener("click", () => setMode("all"));
  els.btnReloadRestaurants?.addEventListener("click", () => loadRestaurants({ force: true }));
  els.btnAdmin?.addEventListener("click", openAdmin);
  els.btnSuggest?.addEventListener("click", openSuggestion);

  setMode("today", { skipRender: true });
  loadRestaurants({ force: false });

  renderEmptyState("Vyber restauraci vlevo.");
}

/* =========================
   MODE SWITCH
========================= */

function setMode(mode, opts = {}) {
  state.mode = mode;

  // UI
  if (mode === "today") {
    els.btnToday?.classList.add("btn-primary");
    els.btnAll?.classList.remove("btn-primary");
  } else {
    els.btnAll?.classList.add("btn-primary");
    els.btnToday?.classList.remove("btn-primary");
  }

  if (!opts.skipRender && state.selectedId) {
    const r = state.restaurants.find(x => x.id === state.selectedId);
    if (r) selectRestaurant(r.id);
  }
}

/* =========================
   RESTAURANTS
========================= */

async function loadRestaurants({ force }) {
  els.restaurantsMeta.textContent = "Načítám…";

  try {
    const data = await fetchRestaurants(force);
    state.restaurants = Array.isArray(data?.restaurants) ? data.restaurants : (Array.isArray(data) ? data : []);
    renderRestaurantsList();

    els.restaurantsMeta.textContent = `${state.restaurants.length} restaurací`;

    // auto-select první, pokud nic vybráno
    if (!state.selectedId && state.restaurants.length > 0) {
      selectRestaurant(state.restaurants[0].id);
    }

  } catch (e) {
    els.restaurantsMeta.textContent = "Chyba načtení seznamu";
    console.error(e);
  }
}

async function fetchRestaurants(force) {
  // Cache signature se mění přes /api/restaurants (restaurants:updatedAt)
  const sigKey = LS_RESTAURANTS_SIG;

  if (!force) {
    try {
      const sig = localStorage.getItem(sigKey);
      // pokud existuje, zkus použít cached response přes fetch cache
      // (stejně ale server vrací no-store, takže pro jednoduchost jen nespěcháme)
    } catch {}
  }

  const resp = await fetch("/api/restaurants", { cache: "no-store" });
  if (!resp.ok) throw new Error("GET /api/restaurants " + resp.status);
  const data = await resp.json();

  try {
    localStorage.setItem(sigKey, String(Date.now()));
  } catch {}

  return data;
}

function renderRestaurantsList() {
  const list = state.restaurants || [];
  if (!list.length) {
    els.restaurantsList.innerHTML = `<div class="empty-state">Zatím žádné restaurace.</div>`;
    return;
  }

  const html = list.map(r => {
    const isSelected = r.id === state.selectedId;
    const cls = "restaurant-item" + (isSelected ? " active-green" : "");
    return `
      <button class="${cls}" data-id="${escapeHtmlAttr(r.id)}" type="button">
        ${escapeHtml(r.name)}
      </button>
    `;
  }).join("");

  els.restaurantsList.innerHTML = html;

  // click handlers
  Array.from(els.restaurantsList.querySelectorAll("button[data-id]")).forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      selectRestaurant(id);
    });
  });
}

/* =========================
   SELECT RESTAURANT
========================= */

async function selectRestaurant(id) {
  state.selectedId = id;
  renderRestaurantsList();

  const r = state.restaurants.find(x => x.id === id);
  if (!r) return;

  els.selectedRestaurantName.textContent = r.name;
  els.selectedRestaurantSub.textContent = r.mode === "embed"
    ? "Zobrazuji zdroj (embed/popup)"
    : "Parsované menu";

  // source link
  if (r.url) {
    els.sourceLink.style.display = "";
    els.sourceLink.href = r.url;
  } else {
    els.sourceLink.style.display = "none";
    els.sourceLink.href = "#";
  }

  // render menu
  renderLoading();

  try {
    const mode = normalizeMode(r.mode);
    if (mode === "embed") {
      renderEmbeddedSource(r.url);
      return;
    }

    // parse mode
    const menus = await fetchMenus(state.mode);
    const item = (menus || []).find(x => String(x.restaurantId) === String(r.id));
    if (!item) {
      renderEmptyState("Menu se nepodařilo načíst.");
      return;
    }

    if (item.kind === "source" && item.url) {
      renderSourceBlock(item.url);
      return;
    }

    if (item.kind === "parsed" && item.meals) {
      renderParsedMenu(item.meals);
      return;
    }

    renderEmptyState("Menu se nepodařilo zobrazit.");
  } catch (e) {
    console.error(e);
    showError("Chyba: " + (e.message || e));
  }
}

function normalizeMode(m) {
  const v = String(m || "").toLowerCase();
  return (v === "embed" || v === "parse") ? v : "parse";
}

/* =========================
   FETCH MENUS
========================= */

async function fetchMenus(mode) {
  const isToday = mode === "today";
  const cacheKey = isToday ? LS_MENU_CACHE_TODAY : LS_MENU_CACHE_ALL;
  const cacheDateKey = isToday ? LS_MENU_CACHE_DATE_TODAY : LS_MENU_CACHE_DATE_ALL;

  // local cache (same day)
  const todayStr = (new Date()).toISOString().slice(0, 10);

  try {
    const cachedDate = localStorage.getItem(cacheDateKey);
    const cached = localStorage.getItem(cacheKey);
    if (cached && cachedDate === todayStr) {
      return JSON.parse(cached);
    }
  } catch {}

  const resp = await fetch(`/api/getMenus?mode=${encodeURIComponent(mode)}`, { cache: "no-store" });
  if (!resp.ok) throw new Error("GET /api/getMenus " + resp.status);
  const data = await resp.json();

  try {
    localStorage.setItem(cacheKey, JSON.stringify(data || []));
    localStorage.setItem(cacheDateKey, todayStr);
  } catch {}

  return data;
}

/* =========================
   RENDERERS
========================= */

function renderLoading() {
  els.menuContainer.innerHTML = `
    <div class="empty-state">
      Načítám…
    </div>
  `;
}

function renderEmptyState(msg) {
  els.menuContainer.innerHTML = `
    <div class="empty-state">
      ${escapeHtml(msg || "")}
    </div>
  `;
}

function showError(msg) {
  els.menuContainer.innerHTML = `
    <div class="empty-state" style="color:#b00020;">
      ${escapeHtml(msg || "")}
    </div>
  `;
}

function renderParsedMenu(meals) {
  if (!meals || meals.length === 0) {
    renderEmptyState("Žádné položky.");
    return;
  }

  const html = meals.map(m => {
    return `
      <div class="meal">
        <div><b>${escapeHtml(m.name || "")}</b></div>
        ${m.price ? `<div class="small-muted">${escapeHtml(m.price)}</div>` : ""}
        ${m.note ? `<div class="small-muted">${escapeHtml(m.note)}</div>` : ""}
      </div>
    `;
  }).join("");

  els.menuContainer.innerHTML = `
    <div class="restaurant">
      ${html}
    </div>
  `;
}

// Pro parse režim - server někdy vrátí "source" (PDF/IMG/WEB) a my to zobrazíme stejně jako embed
function renderSourceBlock(url) {
  renderEmbeddedSource(url);
}

function renderEmbeddedSource(url) {
  // Pokus o embed v iframe.
  // Pokud zdroj blokuje (X-Frame-Options/CSP), iframe ukáže chybu.
  // Pro user-friendly fallback nabízíme i klikací otevření v minimalistickém popupu.
  const safeUrl = url;

  els.menuContainer.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "embed-wrap";

  // Doporučení nad PDF (jen pro PDF zdroje)
  const recBox = ensureRecommendationBox(wrap);
  clearRecommendation(recBox);

  const actions = document.createElement("div");
  actions.className = "embed-actions";

  const openBtn = document.createElement("button");
  openBtn.className = "btn btn-pill";
  openBtn.textContent = "Otevřít v okně";
  openBtn.addEventListener("click", () => openMinimalPopup(safeUrl));
  actions.appendChild(openBtn);

  const hint = document.createElement("div");
  hint.className = "embed-hint";
  hint.textContent = "Pokud se obsah nezobrazí (blokace embed), otevři jej v okně.";
  actions.appendChild(hint);

  const iframe = document.createElement("iframe");
  iframe.className = "embed-frame";
  iframe.src = safeUrl;
  iframe.loading = "lazy";
  iframe.referrerPolicy = "no-referrer-when-downgrade";

  wrap.appendChild(actions);
  wrap.appendChild(iframe);
  els.menuContainer.appendChild(wrap);

  // Pokud je to PDF, zkus z něj vytáhnout názvy jídel a ukázat doporučení
  if (isPdfUrl(safeUrl)) {
    analyzePdfMenuAndRecommend(safeUrl, recBox);
  }
}

function openMinimalPopup(url) {
  // Minimalistické okno (bez toolbaru/URL lišty)
  const w = Math.min(1200, window.screen.width - 40);
  const h = Math.min(900, window.screen.height - 80);
  const left = Math.max(10, (window.screen.width - w) / 2);
  const top = Math.max(10, (window.screen.height - h) / 2);

  const features = [
    `width=${w}`,
    `height=${h}`,
    `left=${left}`,
    `top=${top}`,
    "resizable=yes",
    "scrollbars=yes",
    "toolbar=no",
    "menubar=no",
    "location=no",
    "status=no"
  ].join(",");

  // Použijeme náš viewer.html, který umí otevřít PDF i když je embed blokovaný
  const viewerUrl = `/viewer.html?url=${encodeURIComponent(url)}`;
  window.open(viewerUrl, "_blank", features);
}

/* =========================
   ADMIN / SUGGEST
========================= */

function openAdmin() {
  window.location.href = "/admin.html";
}

function openSuggestion() {
  const w = Math.min(900, window.screen.width - 40);
  const h = Math.min(700, window.screen.height - 80);
  const left = Math.max(10, (window.screen.width - w) / 2);
  const top = Math.max(10, (window.screen.height - h) / 2);

  const features = [
    `width=${w}`,
    `height=${h}`,
    `left=${left}`,
    `top=${top}`,
    "resizable=yes",
    "scrollbars=yes",
    "toolbar=no",
    "menubar=no",
    "location=no",
    "status=no"
  ].join(",");

  window.open("/suggest.html", "_blank", features);
}

/* =========================
   HELPERS
========================= */

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeHtmlAttr(str) { return escapeHtml(str); }

// ===== PDF doporučení (analyzovat menu a dát tipy) =====

function isPdfUrl(url) {
  const u = String(url || "").toLowerCase();
  // zachytí i "menu.pdf?x=1"
  return u.includes(".pdf");
}

function ensureRecommendationBox(parentEl) {
  if (!parentEl) return null;
  let box = parentEl.querySelector(".recommendation-box");
  if (box) return box;

  box = document.createElement("div");
  box.className = "recommendation-box";
  box.style.display = "none";
  parentEl.insertBefore(box, parentEl.firstChild);
  return box;
}

function clearRecommendation(box) {
  if (!box) return;
  box.style.display = "none";
  box.innerHTML = "";
}

function showRecommendation(box, title, text, meta) {
  if (!box) return;

  const safeTitle = escapeHtml(title || "Doporučení z jídelního lístku");
  const safeText = escapeHtml(text || "");

  box.innerHTML = `
    <div class="recommendation-title">${safeTitle}</div>
    <div class="recommendation-text">${safeText.replaceAll("\n", "<br>")}</div>
    ${
      meta
        ? `<div class="recommendation-meta">PDF: ${escapeHtml(String(meta.pages ?? "?"))} str., položek: ${escapeHtml(String(meta.dishCount ?? "?"))}.</div>`
        : ""
    }
  `;
  box.style.display = "";
}

async function analyzePdfMenuAndRecommend(pdfUrl, box) {
  try {
    showRecommendation(box, "Doporučení z PDF menu", "Analyzuji PDF…", null);

    const resp = await fetch(`/api/analyzeMenu?url=${encodeURIComponent(pdfUrl)}`, { method: "GET" });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok || !data?.ok) {
      const err = data?.error || (resp.status + " " + resp.statusText);
      showRecommendation(
        box,
        "Doporučení z PDF menu",
        `Analýza se nepovedla: ${err}\n\nTip: Pokud je PDF jen sken (obrázek), je potřeba OCR (to můžeme doplnit později).`,
        null
      );
      return;
    }

    const summary = String(data?.recommendations?.summary || "").trim();
    const dishCount = data?.meta?.dishCount ?? 0;

    if (!summary || dishCount === 0) {
      showRecommendation(
        box,
        "Doporučení z PDF menu",
        "Z PDF se nepodařilo spolehlivě vytáhnout názvy jídel.\n\nTip: Často je to sken bez textové vrstvy (pak je potřeba OCR).",
        data?.meta || null
      );
      return;
    }

    showRecommendation(
      box,
      "Doporučení z PDF menu",
      summary,
      data?.meta || null
    );
  } catch (e) {
    showRecommendation(
      box,
      "Doporučení z PDF menu",
      `Analýza selhala: ${e?.message || e}`,
      null
    );
  }
}