async function loadToday() {
  loadMenus("today");
}

async function loadAll() {
  loadMenus("all");
}

async function loadMenus(type) {
  const res = await fetch("/api/getMenus?type=" + type);
  const data = await res.json();

  const container = document.getElementById("menuContainer");
  container.innerHTML = "";

  data.forEach(r => {
    const div = document.createElement("div");
    div.className = "restaurant";
    div.innerHTML = `<h3>${r.name}</h3>`;

    (r.meals || []).forEach(m => {
      const mealDiv = document.createElement("div");
      mealDiv.className = "meal";

      const price = m.price ? `${m.price} Kč` : "";
      const day = m.day ? `(${m.day})` : "";

      mealDiv.innerHTML = `
        <div><b>${m.name}</b> ${day}</div>
        <div>💰 ${price || "—"} | 🔥 ${m.calories ?? "?"} kcal</div>
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

loadToday();