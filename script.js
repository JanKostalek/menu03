/* menu03 - script.js
   - Single selection of restaurant (always only one selected)
   - Today / All filter
   - Hybrid Parse/Embed per restaurant
   - PDF / non-embeddable sources open in minimalist popup
*/

const ADMIN_PASSWORD = "H3510";

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
let viewFilter = "today"; // "today" | "all"

init();

function init() {
  wireUi();
  loadRestaurants({ preferCache: true }).catch((e) => {
    showError(`Nepodařilo se načíst restaurace: ${e?.message || e}`);
  });
}

function wireUi() {
  els.btnToday?.addEventListener("click", () => {
    viewFilter = "today";
    setFilterButtons();
    if (selectedRestaurantId) loadSelectedRestaurantMenu();
  });

  els.btnAll?.addEventListener("click", () => {
    viewFilter = "all";
    setFilterButtons();
    if (selectedRestaurantId) loadSelectedRestaurantMenu();
  });

  els.btnReloadRestaurants?.addEventListener("click", () => {
    loadRestaurants({ preferCache: false }).catch((e) => {
      showError(`Nepodařilo se obnovit restaurace: ${e?.message || e}`);
    });
  });

  els.btnAdmin?.addEventListener("click", openAdmin);
  els.btnSuggest?.addEventListener("click", openSuggestion);

  setFilterButtons();
}

function setFilterButtons() {
  if (!els.btnToday || !els.btnAll) return;
  if (viewFilter === "today") {
    els.btnToday.classList.add("btn-primary");
    els.btnAll.classList.remove("btn-primary");
  } else {
    els.btnAll.classList.add("btn-primary");
    els.btnToday.classList.remove("btn-primary");
  }
}

async function loadRestaurants({ preferCache }) {
  // preferCache=true -> běžné načtení; false -> vždy fresh přes cache-buster
  const cacheBuster = preferCache ? "" : `?t=${Date.now()}`;
  const res = await fetch(`/api/restaurants${cacheBuster}`, { method: "GET" });
  if (!res.ok) throw new Error(await safeReadText(res));
  const data = await res.json();

  // API vrací {restaurants:[...]}
  restaurants = Array.isArray(data?.restaurants) ? data.restaurants : [];
  renderRestaurantsList();

  els.restaurantsMeta.textContent = restaurants.length
    ? `${restaurants.length} položek`
    : `Žádné restaurace`;

  // pokud byla vybraná restaurace a stále existuje, nech ji vybranou a přenačti menu
  if (selectedRestaurantId && restaurants.some(r => r.id === selectedRestaurantId)) {
    setSelectedRestaurant(selectedRestaurantId, { scrollIntoView: false, loadMenu: true });
  } else {
    // pokud vybraná restaurace zmizela, vyčisti výběr (single selection)
    selectedRestaurantId = null;
    renderSelectionHeader(null);
    renderEmptyState("Vyber restauraci vlevo.");
    els.sourceLink.style.display = "none";
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

    // zelené (aktivní) tlačítko pro právě vybranou restauraci
    if (r.id === selectedRestaurantId) {
      btn.classList.add("restaurant-selected");
    }

    btn.textContent = r.name || r.id;

    btn.addEventListener("click", () => {
      // SINGLE selection: kliknutím se vždy vybere jen tato jedna restaurace
      setSelectedRestaurant(r.id, { scrollIntoView: true, loadMenu: true });
    });

    els.restaurantsList.appendChild(btn);
  });
}

function setSelectedRestaurant(id, { scrollIntoView, loadMenu }) {
  if (!id) return;

  // pokud kliknu na stejnou, nech vybranou (ale klidně refreshni menu)
  const changed = selectedRestaurantId !== id;
  selectedRestaurantId = id;

  // přepni UI tak, aby byla vybraná jen jedna
  updateSelectedButtonUI(id);

  const r = restaurants.find(x => x.id === id) || null;
  renderSelectionHeader(r);

  if (scrollIntoView) {
    const btn = els.restaurantsList?.querySelector(`button[data-id="${cssEscape(id)}"]`);
    btn?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  if (loadMenu) {
    loadSelectedRestaurantMenu().catch((e) => {
      showError(`Nepodařilo se načíst menu: ${e?.message || e}`);
    });
  }

  // kdyby se používal nějaký další stav, tady je jistota že je to single selection
  if (changed) {
    // nic extra; jen pro čitelnost
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
    return;
  }

  els.selectedRestaurantName.textContent = r.name || r.id;

  const mode = r.mode || "parse"; // "parse" | "embed"
  const url = r.url || r.link || "";
  els.selectedRestaurantSub.textContent = [
    mode === "embed" ? "Režim: Embed" : "Režim: Parse",
    url ? `Zdroj: ${url}` : null
  ].filter(Boolean).join(" • ");
}

async function loadSelectedRestaurantMenu() {
  const r = restaurants.find(x => x.id === selectedRestaurantId);
  if (!r) {
    renderEmptyState("Vyber restauraci vlevo.");
    return;
  }

  const url = r.url || r.link;
  const mode = (r.mode || "parse").toLowerCase();

  // zobraz tlačítko "Otevřít zdroj"
  if (url) {
    els.sourceLink.href = url;
    els.sourceLink.style.display = "";
    els.sourceLink.onclick = (e) => {
      // pokud se zdroj nedá embeddovat, uživatel si ho stejně může otevřít
      // necháme default (new tab)
    };
  } else {
    els.sourceLink.style.display = "none";
  }

  // 1) Embed režim: preferuj iframe/embed zdroje
  if (mode === "embed") {
    if (!url) {
      renderEmptyState("Chybí URL zdroje.");
      return;
    }
    renderEmbeddedSource(url);
    return;
  }

  // 2) Parse režim: pokud je to PDF/obrázek, ukaž přímo (iframe pokud jde)
  if (url && looksLikePdfOrImage(url)) {
    renderEmbeddedSource(url);
    return;
  }

  // 3) Parse režim + HTML: načti přes /api/getMenus (dnešní/celé)
  renderLoading();
  const q = new URLSearchParams();
  q.set("id", r.id);
  q.set("view", viewFilter); // "today" | "all"

  const res = await fetch(`/api/getMenus?${q.toString()}`, { method: "GET" });
  if (!res.ok) {
    throw new Error(await safeReadText(res));
  }
  const data = await res.json();

  // očekáváme { html, text, items, sourceUrl, warning, ... } - vykreslíme co je k dispozici
  renderParsedMenu(data, r);
}

function renderEmbeddedSource(url) {
  // Pokus o embed v iframe.
  // Pokud zdroj blokuje (X-Frame-Options/CSP), iframe ukáže chybu.
  // Pro user-friendly fallback nabízíme i klikací otevření v minimalistickém popupu.
  const safeUrl = url;

  els.menuContainer.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "embed-wrap";

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
}

function renderParsedMenu(data, r) {
  els.menuContainer.innerHTML = "";

  if (data?.warning) {
    const warn = document.createElement("div");
    warn.className = "alert alert-warn";
    warn.textContent = String(data.warning);
    els.menuContainer.appendChild(warn);
  }

  // 1) Pokud API vrátí hotové HTML, vykresli
  if (data?.html) {
    const div = document.createElement("div");
    div.className = "parsed-html";
    div.innerHTML = data.html;
    els.menuContainer.appendChild(div);
    return;
  }

  // 2) Pokud vrátí items (seznam), vykresli jednoduše
  if (Array.isArray(data?.items) && data.items.length) {
    const list = document.createElement("div");
    list.className = "menu-items";

    data.items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "menu-item";

      const name = document.createElement("div");
      name.className = "menu-item-name";
      name.textContent = it.name || it.title || "";

      const meta = document.createElement("div");
      meta.className = "menu-item-meta";
      const parts = [];
      if (it.price) parts.push(String(it.price));
      if (it.note) parts.push(String(it.note));
      if (it.date) parts.push(String(it.date));
      meta.textContent = parts.join(" • ");

      row.appendChild(name);
      if (meta.textContent) row.appendChild(meta);
      list.appendChild(row);
    });

    els.menuContainer.appendChild(list);
    return;
  }

  // 3) Fallback na text
  const text = (data?.text || "").trim();
  if (text) {
    const pre = document.createElement("pre");
    pre.className = "parsed-text";
    pre.textContent = text;
    els.menuContainer.appendChild(pre);
    return;
  }

  // 4) Nic
  renderEmptyState("Menu se nepodařilo načíst nebo je prázdné.");
}

function renderLoading() {
  els.menuContainer.innerHTML = `
    <div class="empty-state">Načítám…</div>
  `;
}

function renderEmptyState(msg) {
  els.menuContainer.innerHTML = `
    <div class="empty-state">${escapeHtml(msg)}</div>
  `;
}

function showError(msg) {
  els.menuContainer.innerHTML = `
    <div class="alert alert-error">${escapeHtml(msg)}</div>
  `;
}

function openAdmin() {
  const pass = prompt("Zadej heslo pro administraci:");
  if (pass !== ADMIN_PASSWORD) {
    alert("Špatné heslo.");
    return;
  }
  window.location.href = "admin.html";
}

function openSuggestion() {
  window.location.href = "suggest.html";
}

function openMinimalPopup(url) {
  // minimalistické okno bez lišty (jak to máš v projektu)
  try {
    window.open(url, "_blank", "popup=yes,noopener,noreferrer,width=1100,height=800");
  } catch {
    // fallback
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

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// CSS.escape polyfill fallback
function cssEscape(v) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(v);
  return String(v).replace(/["\\]/g, "\\$&");
}