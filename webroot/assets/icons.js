// Injeta o sprite de ícones (assets/icons.svg) no <body> uma vez por página,
// deixando os <symbol> disponíveis pra qualquer <svg class="icon"><use
// href="#icon-nome"></use></svg> da página resolver. Carregado com defer —
// não bloqueia o render; os ícones aparecem assim que o sprite chega (fetch
// local, mesma origem, geralmente perto de instantâneo).
(function () {
  fetch("/assets/icons.svg")
    .then((res) => res.text())
    .then((svgText) => {
      const wrap = document.createElement("div");
      wrap.style.display = "none";
      wrap.setAttribute("aria-hidden", "true");
      wrap.innerHTML = svgText;
      document.body.prepend(wrap);
    })
    .catch((err) => console.error("[ICONS] Falha ao carregar sprite:", err));
})();
