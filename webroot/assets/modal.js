/* ---------------- Modal customizado (substitui confirm()/alert() nativos) ----------------
   Compartilhado entre admin.html, barber.html e minha-conta.html. Renderiza
   via portal (document.body), com blur no fundo e ícone contextual. */
function ensureModalRoot() {
  let overlay = document.getElementById("app-modal-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "app-modal-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-icon"></div>
      <div class="modal-message"></div>
      <div class="modal-actions"></div>
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function openModal({ icon, iconClass, message, buttons }) {
  const overlay = ensureModalRoot();
  overlay.querySelector(".modal-icon").textContent = icon;
  overlay.querySelector(".modal-icon").className = `modal-icon ${iconClass}`;
  overlay.querySelector(".modal-message").textContent = message;
  const actions = overlay.querySelector(".modal-actions");
  actions.innerHTML = "";
  return new Promise((resolve) => {
    const close = (value) => {
      overlay.classList.remove("is-open");
      resolve(value);
    };
    buttons.forEach(({ label, value, className }) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = className;
      btn.addEventListener("click", () => close(value));
      actions.appendChild(btn);
    });
    // setTimeout em vez de requestAnimationFrame: rAF fica pausado quando a
    // aba não está em primeiro plano, e o modal precisa abrir de qualquer jeito.
    setTimeout(() => overlay.classList.add("is-open"), 10);
  });
}

// Substitui window.confirm() — resolve true/false.
function showConfirmModal(message, { destructive = true } = {}) {
  return openModal({
    icon: destructive ? "⚠" : "?",
    iconClass: destructive ? "warn" : "success",
    message,
    buttons: [
      { label: "Cancelar", value: false, className: "btn-secondary" },
      { label: "Confirmar", value: true, className: destructive ? "btn-danger" : "btn-primary" },
    ],
  });
}

// Substitui window.alert() — resolve quando o usuário clica OK.
function showAlertModal(message, { variant = "error" } = {}) {
  return openModal({
    icon: variant === "success" ? "✓" : "⚠",
    iconClass: variant === "success" ? "success" : "warn",
    message,
    buttons: [{ label: "OK", value: true, className: "btn-primary" }],
  });
}
