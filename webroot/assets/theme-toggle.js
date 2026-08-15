/* ---------------- Toggle de tema claro/escuro ----------------
   Espera os elementos #theme-switch / #theme-knob no DOM. Persiste em
   localStorage e dispara "themechange" no document pra páginas que
   precisem reagir (ex: admin.html recolorindo os gráficos do Chart.js). */
(function () {
  const themeSwitch = document.getElementById("theme-switch");
  const themeKnob = document.getElementById("theme-knob");
  if (!themeSwitch || !themeKnob) return;

  // Bolinha lisa, sem emoji de sol/lua — a posição (esquerda/direita) já diz
  // qual tema está ativo, o glyph só acrescentava ruído visual.
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
  }

  themeSwitch.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "light" ? "dark" : "light");
  });

  // O tema em si já foi aplicado por assets/theme-init.js, que roda síncrono
  // no <head> pra evitar flash — nada mais a sincronizar aqui além do clique.
})();
