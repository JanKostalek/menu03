/* menu03 - script.js */

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
  menuContainer: document.getElementById("menuContainer"),
  sourceLink: document.getElementById("sourceLink"),
};

let restaurants = [];
let selectedRestaurantId = null;
let viewFilter = "today"; // today | all

init();

function init() {
  els.btnToday?.addEventListener("click", () => setFilter("today"));
  els.btnAll?.addEventListener("click", () => setFilter("all"));

  els.btnReloadRestaurants?.addEventListener("click", () => loadRestaurants({ force: true }));

  // POPUP okna
  els.btnAdmin?.addEventListener("click", openAdminPopup);
  els.btnSuggest?.addEventListener("click", openSuggestPopup);

  setFilter("today", { skipReload: true });
  loadRestaurants({ force: false }).catch((e) => showError(e?.message || String(e)));
}

function setFilter(filter, { skipReload } = {}) {
  viewFilter = filter === "all" ? "all" : "today";

  if (els.btnToday && els.btnAll) {
    if (viewFilter === "today") {
      els.btnToday.classList.add("btn-primary");
      els.btnAll.classList.remove("btn-primary");
    } else {
      els.btnAll.classList.add("btn-primary");
      els.btnToday.classList.remove("btn-primary");
    }
  }

  if (!skipReload && selectedRestaurantId) {
    loadSelectedRestaurantMenu().catch((e) => showError(e?.message || String(e)));
  }
}

async function loadRestaurants({ force }) {
  if (els.restaurantsMeta) els.restaurantsMeta.textContent = "Načítám…";

  const resp = await fetch("/api/restaurants", { cache: force ? "no-store" : "no-store" });
  if (!resp.ok) throw new Error("GET /api/restaurants " + resp.status);

  const data = await resp.json();
  restaurants = Array.isArray(data?.restaurants) ? data.restaurants : Array.isArray(data) ? data : [];

  if (els.restaurantsMeta) els.restaurantsMeta.textContent = `${restaurants.length} restaurací`;

  renderRestaurantsList();

  if (!selectedRestaurantId && restaurants.length) {
    setSelectedRestaurant(restaurants[0].id, { scrollIntoView: false, loadMenu: true });
  } else if (selectedRestaurantId) {
    // po reloadu udrž výběr (pokud existuje), jinak vyber první
    const exists = restaurants.some((r) => r.id === selectedRestaurantId);
    if (!exists && restaurants.length) {
      setSelectedRestaurant(restaurants[0].id, { scrollIntoView: false, loadMenu: true });
    } else {
      updateSelectedButtonUI(selectedRestaurantId);
    }
  }
}

function renderRestaurantsList() {
  if (!els.restaurantsList) return;

  els.restaurantsList.innerHTML = "";

  if (!restaurants.length) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.textContent = "Žádné restaurace.";
    els.restaurantsList.appendChild(div);
    return;
  }

  restaurants.forEach((r) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "restaurant-item btn btn-block";
    btn.dataset.id = r.id;

    if (r.id === selectedRestaurantId) btn.classList.add("restaurant-selected");

    btn.textContent = r.name || r.id;

    btn.addEventListener("click", () => {
      // vždy jen JEDNA vybraná restaurace
      setSelectedRestaurant(r.id, { scrollIntoView: true, loadMenu: true });
    });

    els.restaurantsList.appendChild(btn);
  });
}

function setSelectedRestaurant(id, { scrollIntoView, loadMenu }) {
  if (!id) return;

  selectedRestaurantId = id;
  updateSelectedButtonUI(id);

  const r = restaurants.find((x) => x.id === id) || null;
  renderSelectionHeader(r);

  if (scrollIntoView) {
    const btn = els.restaurantsList?.querySelector(`button[data-id="${cssEscape(id)}"]`);
    btn?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  if (loadMenu) {
    loadSelectedRestaurantMenu().catch((e) => showError(`Nepodařilo se načíst menu: ${e?.message || e}`));
  }
}

function updateSelectedButtonUI(selectedId) {
  if (!els.restaurantsList) return;
  const allButtons = els.restaurantsList.querySelectorAll("button.restaurant-item");
  allButtons.forEach((b) => {
    if (b.dataset.id === selectedId) b.classList.add("restaurant-selected");
    else b.classList.remove("restaurant-selected");
  });
}

function renderSelectionHeader(r) {
  if (!r) {
    els.selectedRestaurantName.textContent = "Vyber restauraci vlevo";
    els.selectedRestaurantSub.textContent = "";
    if (els.sourceLink) els.sourceLink.style.display = "none";
    return;
  }

  els.selectedRestaurantName.textContent = r.name || r.id;

  const mode = (r.mode || "parse").toLowerCase(); // parse | embed
  const url = r.url || r.link || "";

  els.selectedRestaurantSub.textContent = mode === "embed" ? "Režim: Embed" : "Režim: Parse";

  if (els.sourceLink) {
    if (url) {
      els.sourceLink.href = url;
      els.sourceLink.style.display = "";
    } else {
      els.sourceLink.style.display = "none";
    }
  }
}

async function loadSelectedRestaurantMenu() {
  const r = restaurants.find((x) => x.id === selectedRestaurantId);
  if (!r) return;

  const mode = (r.mode || "parse").toLowerCase();
  const url = r.url || r.link || "";

  if (!els.menuContainer) return;
  els.menuContainer.innerHTML = `<div class="empty-state">Načítám…</div>`;

  if (mode === "embed") {
    renderEmbedded(url);
    return;
  }

  // parse mode -> vezmeme z /api/getMenus
  const resp = await fetch(`/api/getMenus?mode=${encodeURIComponent(viewFilter)}`, { cache: "no-store" });
  if (!resp.ok) throw new Error("GET /api/getMenus " + resp.status);

  const items = await resp.json();
  const entry = Array.isArray(items)
    ? items.find((x) => String(x.restaurantId) === String(r.id))
    : null;

  if (!entry) {
    els.menuContainer.innerHTML = `<div class="empty-state">Menu se nepodařilo načíst.</div>`;
    return;
  }

  if (entry.kind === "source" && entry.url) {
    renderEmbedded(entry.url);
    return;
  }

  if (entry.kind === "parsed" && Array.isArray(entry.meals)) {
    renderParsed(entry.meals);
    return;
  }

  els.menuContainer.innerHTML = `<div class="empty-state">Menu se nepodařilo zobrazit.</div>`;
}

function renderParsed(meals) {
  if (!els.menuContainer) return;

  if (!meals.length) {
    els.menuContainer.innerHTML = `<div class="empty-state">Žádné položky.</div>`;
    return;
  }

  const html = meals
    .map((m) => {
      const name = escapeHtml(m.name || "");
      const price = m.price ? `<div class="small-muted">${escapeHtml(m.price)}</div>` : "";
      const note = m.note ? `<div class="small-muted">${escapeHtml(m.note)}</div>` : "";
      return `<div class="meal"><div><b>${name}</b></div>${price}${note}</div>`;
    })
    .join("");

  els.menuContainer.innerHTML = `<div class="restaurant">${html}</div>`;
}

function renderEmbedded(url) {
  if (!els.menuContainer) return;

  if (!url) {
    els.menuContainer.innerHTML = `<div class="empty-state">Chybí URL zdroje.</div>`;
    return;
  }

  const isPdf = looksLikePdfOrImage(url) && String(url).toLowerCase().includes(".pdf");
  const isImg = looksLikePdfOrImage(url) && !isPdf;

  const openBtn = `
    <button class="btn-action" type="button" id="btnOpenSource">
      Otevřít ${isPdf ? "PDF" : "zdroj"}
    </button>
  `;

  const note = isPdf
    ? `<div class="source-note">Pokud se náhled nezobrazí, použijte tlačítko <b>Otevřít PDF</b> výše.</div>`
    : `<div class="source-note">Pokud se náhled nezobrazí, použijte tlačítko <b>Otevřít zdroj</b> výše.</div>`;

  let frame = "";
  if (isImg) {
    frame = `
      <div class="img-wrap">
        <img class="menu-image" src="${escapeHtml(url)}" alt="Menu" />
      </div>
    `;
  } else {
    // pdf nebo web
    const cls = isPdf ? "pdf-frame" : "web-frame";
    frame = `
      <div class="${isPdf ? "pdf-wrap" : "web-wrap"}">
        <iframe class="${cls}" src="${escapeHtml(url)}" loading="lazy"></iframe>
      </div>
    `;
  }

  els.menuContainer.innerHTML = `
    <div class="source-block">
      <div class="source-actions">
        ${openBtn}
      </div>
      ${note}
      ${frame}
    </div>
  `;

  const btn = document.getElementById("btnOpenSource");
  btn?.addEventListener("click", () => openMinimalPopup(`/viewer.html?url=${encodeURIComponent(url)}`));
}

function openAdminPopup() {
  // admin.html už řeší heslo sám, takže tady žádný prompt (aby nebyl 2x)
  openMinimalPopup("admin.html");
}

function openSuggestPopup() {
  openMinimalPopup("suggest.html");
}

function openMinimalPopup(url) {
  try {
    window.open(url, "_blank", "popup=yes,noopener,noreferrer,width=1100,height=800");
  } catch {
    window.open(url, "_blank");
  }
}

function looksLikePdfOrImage(url) {
  const u = String(url).toLowerCase();
  return (
    u.includes(".pdf") ||
    u.includes(".png") ||
    u.includes(".jpg") ||
    u.includes(".jpeg") ||
    u.includes(".webp")
  );
}

function showError(msg) {
  if (!els.menuContainer) return;
  els.menuContainer.innerHTML = `<div class="empty-state" style="color:#b00020;">${escapeHtml(msg)}</div>`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// CSS.escape fallback
function cssEscape(v) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(v);
  return String(v).replace(/["\\]/g, "\\$&");
}