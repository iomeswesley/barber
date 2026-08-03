/* ---------------- Aplicação do tema ANTES da primeira pintura ----------------
   Precisa ser carregado no <head> SEM defer/async, em todas as páginas. Se o
   tema só fosse aplicado por theme-toggle.js (que é defer), o navegador já
   teria pintado a página no tema padrão do HTML e o usuário de tema escuro
   veria um flash branco a cada navegação.

   Também é aqui que mora a limpeza da preferência antiga: só 3 páginas têm o
   switch de tema, então se essa lógica ficasse no theme-toggle.js as outras
   nunca corrigiriam um valor obsoleto no localStorage. */
(function () {
  try {
    // O redesign "Google style" mudou o padrão de escuro pra claro. Quem já
    // tinha usado o painel antes tinha "dark" gravado e continuaria caindo no
    // tema antigo achando que nada mudou — essa marca de versão descarta a
    // preferência salva uma única vez, por usuário. Só trocar o valor de novo
    // se houver outra virada de padrão no futuro.
    var VERSION = "2026-08-google-light";
    if (localStorage.getItem("themeDefaultVersion") !== VERSION) {
      localStorage.removeItem("theme");
      localStorage.setItem("themeDefaultVersion", VERSION);
    }
    var saved = localStorage.getItem("theme");
    // Claro é o padrão: só sobrescreve o atributo do HTML se o usuário tiver
    // escolhido explicitamente um tema válido.
    if (saved === "dark" || saved === "light") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  } catch (e) {
    /* localStorage bloqueado (modo privado/cookies off) — segue no tema
       padrão do HTML, que é o claro. Não é erro fatal. */
  }
})();
