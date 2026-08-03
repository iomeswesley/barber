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

  // O tema em si já foi aplicado por assets/theme-init.js, que roda síncrono
  // no <head> pra evitar flash — aqui só resta sincronizar o ícone do switch.
  // Nada de disparar "themechange" neste ponto: os gráficos ainda nem existem
  // e o evento provocaria um refresh prematuro. Ele só dispara no clique.
  const currentTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  themeKnob.textContent = currentTheme === "light" ? "☀️" : "🌙";
})();
