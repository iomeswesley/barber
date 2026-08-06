/* ---------------- Dropdown genérico de topbar ----------------
   Liga um botão-gatilho a um painel (.dropdown-panel): abre no clique,
   fecha ao clicar fora, ao apertar Escape, ou ao abrir outro dropdown.
   Usado pelos menus de notificações, ajuda, avatar e período do topbar —
   evita reimplementar a mesma lógica de abrir/fechar em cada um. */
(function () {
  const openDropdowns = new Set();

  function closeDropdown(panel) {
    panel.classList.remove("is-open");
    openDropdowns.delete(panel);
  }

  function closeAllExcept(exceptPanel) {
    openDropdowns.forEach((panel) => {
      if (panel !== exceptPanel) closeDropdown(panel);
    });
  }

  window.initDropdown = function initDropdown(triggerId, panelId, opts) {
    const trigger = document.getElementById(triggerId);
    const panel = document.getElementById(panelId);
    if (!trigger || !panel) return null;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = !panel.classList.contains("is-open");
      closeAllExcept(null);
      if (willOpen) {
        panel.classList.add("is-open");
        openDropdowns.add(panel);
        if (opts && typeof opts.onOpen === "function") opts.onOpen();
      }
    });

    panel.addEventListener("click", (e) => e.stopPropagation());

    return {
      close: () => closeDropdown(panel),
    };
  };

  document.addEventListener("click", () => closeAllExcept(null));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllExcept(null);
  });
})();
