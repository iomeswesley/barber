// Trava real de acesso ao painel quando a assinatura da barbearia está
// cancelada (ver requireBillingOk em src/middleware/billing.ts). Duas linhas
// de defesa:
//
// 1) Checagem proativa no boot da página — evita o usuário ver o painel
//    "piscar" antes de qualquer chamada de API bater no 402.
// 2) Interceptação de toda resposta 402 com { error: "billing_blocked" } —
//    cobre o caso de a assinatura ser cancelada (webhook do Stripe, ou o
//    cron de trial vencido) enquanto o painel já está aberto numa aba.
//
// Carregar com defer, depois de theme-init.js/theme.css, em admin.html e
// barber.html (não em login/signup/páginas públicas — só faz sentido depois
// de autenticado).
(function () {
  let redirecting = false;
  function goToBillingRequired() {
    if (redirecting) return;
    redirecting = true;
    window.location.href = "/billing-required.html";
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const res = await originalFetch(...args);
    if (res.status === 402 && !redirecting) {
      res
        .clone()
        .json()
        .then((data) => {
          if (data && data.error === "billing_blocked") goToBillingRequired();
        })
        .catch(() => {});
    }
    return res;
  };

  fetch("/api/billing/status")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && data.status === "canceled") goToBillingRequired();
    })
    .catch(() => {});
})();
