/* ---------------- Tour guiado (spotlight) ----------------
   Compartilhado entre admin.html e barber.html. Cada passo pode apontar pra
   um elemento (selector) e, opcionalmente, indicar um outro elemento pra
   clicar antes de mostrar (activateSelector) — usado pra trocar de aba antes
   de destacar algo que só existe em outra página do painel.
   Uso: startTour([{ selector, title, text, activateSelector? }, ...]) */

function ensureTourRoot() {
  let root = document.getElementById("app-tour-root");
  if (root) return root;
  root = document.createElement("div");
  root.id = "app-tour-root";
  root.innerHTML = `
    <div class="tour-blocker"></div>
    <div class="tour-highlight"></div>
    <div class="tour-tooltip">
      <div class="tour-step-count"></div>
      <div class="tour-title"></div>
      <div class="tour-text"></div>
      <div class="tour-actions">
        <button type="button" class="tour-skip">Pular tour</button>
        <div class="tour-nav">
          <button type="button" class="tour-prev">‹ Anterior</button>
          <button type="button" class="tour-next">Próximo ›</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

let tourSteps = [];
let tourIndex = 0;
let tourOnDone = null;

function renderTourStep() {
  const root = ensureTourRoot();
  const step = tourSteps[tourIndex];
  const highlight = root.querySelector(".tour-highlight");
  const tooltip = root.querySelector(".tour-tooltip");

  if (step.activateSelector) {
    const activator = document.querySelector(step.activateSelector);
    if (activator) activator.click();
  }

  root.querySelector(".tour-step-count").textContent = `${tourIndex + 1} / ${tourSteps.length}`;
  root.querySelector(".tour-title").textContent = step.title;
  root.querySelector(".tour-text").textContent = step.text;
  root.querySelector(".tour-prev").style.visibility = tourIndex === 0 ? "hidden" : "visible";
  root.querySelector(".tour-next").textContent = tourIndex === tourSteps.length - 1 ? "Concluir" : "Próximo ›";

  // Espera o click acima (troca de aba) renderizar antes de medir a posição.
  setTimeout(() => {
    const target = step.selector ? document.querySelector(step.selector) : null;
    if (!target) {
      highlight.style.display = "none";
      tooltip.style.top = "50%";
      tooltip.style.left = "50%";
      tooltip.style.transform = "translate(-50%, -50%)";
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const pad = 8;
      highlight.style.display = "block";
      highlight.style.top = `${rect.top - pad + window.scrollY}px`;
      highlight.style.left = `${rect.left - pad + window.scrollX}px`;
      highlight.style.width = `${rect.width + pad * 2}px`;
      highlight.style.height = `${rect.height + pad * 2}px`;

      const tooltipWidth = Math.min(320, window.innerWidth - 24);
      let left = rect.left + window.scrollX;
      left = Math.min(left, window.scrollX + window.innerWidth - tooltipWidth - 12);
      left = Math.max(left, window.scrollX + 12);
      const spaceBelow = window.innerHeight - rect.bottom;
      const top =
        spaceBelow > 220
          ? rect.bottom + pad * 2 + window.scrollY
          : rect.top + window.scrollY - pad * 2 - 200;
      tooltip.style.top = `${Math.max(top, window.scrollY + 12)}px`;
      tooltip.style.left = `${left}px`;
      tooltip.style.width = `${tooltipWidth}px`;
      tooltip.style.transform = "none";
    }, 260);
  }, step.activateSelector ? 120 : 0);
}

function endTour() {
  const root = document.getElementById("app-tour-root");
  if (root) root.remove();
  fetch("/api/auth/tour-seen", { method: "POST" }).catch(() => {});
  if (tourOnDone) tourOnDone();
}

function startTour(steps, { onDone } = {}) {
  if (!steps || steps.length === 0) return;
  tourSteps = steps;
  tourIndex = 0;
  tourOnDone = onDone || null;
  const root = ensureTourRoot();
  root.querySelector(".tour-skip").onclick = endTour;
  root.querySelector(".tour-prev").onclick = () => {
    if (tourIndex > 0) {
      tourIndex--;
      renderTourStep();
    }
  };
  root.querySelector(".tour-next").onclick = () => {
    if (tourIndex < tourSteps.length - 1) {
      tourIndex++;
      renderTourStep();
    } else {
      endTour();
    }
  };
  renderTourStep();
}
