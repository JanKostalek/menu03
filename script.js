function renderFilters() {
  const container = document.getElementById("filterContainer");
  if (!container) return;

  if (!restaurantsList || restaurantsList.length === 0) {
    container.innerHTML = `<div class="small-muted">Zatím žádné restaurace.</div>`;
    return;
  }

  const html = restaurantsList.map(r => {
    const enabled = isEnabledByFilter(r.name);
    const activeClass = enabled ? "filter-chip active" : "filter-chip";
    const check = enabled ? `<span class="chip-check">✓</span>` : "";
    return `
      <button
        type="button"
        class="${activeClass}"
        data-name="${escapeHtmlAttr(r.name)}"
        aria-pressed="${enabled ? "true" : "false"}"
        title="${escapeHtmlAttr(r.name)}"
      >
        <span class="chip-label">${escapeHtml(r.name)}</span>
        ${check}
      </button>
    `;
  }).join("");

  container.innerHTML = html;

  container.querySelectorAll(".filter-chip").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const name = e.currentTarget.getAttribute("data-name");
      const currentlyEnabled = isEnabledByFilter(name);

      setFilter(name, !currentlyEnabled);
      renderFilters();   // jen překreslí chipy
      renderMenus();     // okamžitě přefiltruje menu
    });
  });
}