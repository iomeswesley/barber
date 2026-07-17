/* ---------------- Toggle de tema claro/escuro ----------------
   Espera os elementos #theme-switch / #theme-knob no DOM. Persiste em
   localStorage e dispara "themechange" no document pra páginas que
   precisem reagir (ex: admin.html recolorindo os gráficos do Chart.js). */
(function () {
  const themeSwitch = document.getElementById("theme-switch");
  const themeKnob = document.getElementById("theme-knob");
  if (!themeSwitch || !themeKnob) return;

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeKnob.textContent = theme === "light" ? "☀️" : "🌙";
    localStorage.setItem("theme", theme);
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
  }

  themeSwitch.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "light" ? "dark" : "light");
  });

  // Init roda antes de qualquer gráfico existir na página — seta o tema
  // direto (sem disparar "themechange") pra não acionar um refresh de
  // chart prematuro. O evento só dispara depois, no toggle manual.
  const savedTheme = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  themeKnob.textContent = savedTheme === "light" ? "☀️" : "🌙";
})();
