function qs(name) {
  return new URLSearchParams(window.location.search).get(name) || "";
}

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

function showMessage(text) {
  const box = document.getElementById("message");
  if (!box) return;
  box.hidden = false;
  box.textContent = text;
}

function hideMessage() {
  const box = document.getElementById("message");
  if (!box) return;
  box.hidden = true;
  box.textContent = "";
}

async function checkEmbeddable(url) {
  try {
    const r = await fetch(`/api/checkEmbed?url=${encodeURIComponent(url)}`, { cache: "no-store" });
    const data = await r.json();
    return !!data.embeddable;
  } catch {
    return true; // když se check nepovede, zkusíme embed
  }
}

(async function init() {
  const url = qs("url");
  const frame = document.getElementById("frame");

  document.getElementById("btnClose")?.addEventListener("click", () => window.close());
  document.getElementById("btnOpenDirect")?.addEventListener("click", () => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  });

  if (!url) {
    setStatus("Chybí URL");
    showMessage("Chybí parametr URL.");
    if (frame) frame.style.display = "none";
    return;
  }

  setStatus("Ověřuji možnost vložení…");
  const embeddable = await checkEmbeddable(url);

  if (!embeddable) {
    setStatus("Blokováno zdrojem");
    showMessage("Otevření menu je blokováno zdrojovou stránkou. Použijte prosím tlačítko „Otevřít přímo“.");
    if (frame) frame.style.display = "none";
    return;
  }

  hideMessage();
  setStatus("Načítám PDF…");
  if (frame) frame.src = url;

  // jen kosmeticky – po chvíli přepnout status
  setTimeout(() => setStatus("Zobrazeno (pokud se nenačetlo, použijte „Otevřít přímo“)"), 1500);
})();