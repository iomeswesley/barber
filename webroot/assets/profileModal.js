/* ---------------- Popup "Minha conta" (nome + foto) ----------------
   Substitui a antiga minha-conta.html, que na verdade é a tela pública de
   autoatendimento do CLIENTE (cancelar/remarcar agendamento) — não tem nada
   a ver com o perfil de quem está logado no painel.

   Chame window.openProfileModal(me, onSaved) — `me` é o objeto de
   /api/auth/me, `onSaved(updated)` roda depois de salvar com sucesso.
   Depende de showAlertModal (assets/modal.js) e de avatarColor()/initials()
   já definidas no <script> inline de cada página. */
function ensureProfileModalRoot() {
  let overlay = document.getElementById("profile-modal-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "profile-modal-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box" style="text-align:left; max-width:320px;">
      <div style="text-align:center; margin-bottom:18px;">
        <div class="avatar-btn" id="profile-modal-avatar" style="width:72px; height:72px; font-size:24px; margin:0 auto; cursor:pointer;" title="Trocar foto"></div>
        <button type="button" class="link-back" id="profile-modal-photo-btn" style="margin-top:10px; font-size:11.5px; display:inline-block;">Trocar foto</button>
        <input type="file" id="profile-modal-photo-input" accept="image/*" style="display:none;" />
      </div>
      <div class="form-field">
        <label>Nome</label>
        <input type="text" id="profile-modal-name" />
      </div>
      <div class="modal-actions" style="margin-top:18px;">
        <button class="btn-secondary" id="profile-modal-cancel">Cancelar</button>
        <button class="btn-primary" id="profile-modal-save">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  // Mesmo truque do client-modal-overlay em admin.html: força um reflow logo
  // após inserir no DOM, senão a transição de entrada não anima na 1ª abertura.
  void overlay.offsetHeight;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeProfileModal(); });
  overlay.querySelector("#profile-modal-cancel").addEventListener("click", closeProfileModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("is-open")) closeProfileModal();
  });
  return overlay;
}

function closeProfileModal() {
  document.getElementById("profile-modal-overlay")?.classList.remove("is-open");
}

function renderProfileAvatar(el, name, avatarUrl) {
  if (avatarUrl) {
    el.style.backgroundImage = `url("${avatarUrl}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.textContent = "";
  } else {
    el.style.backgroundImage = "";
    el.style.background = avatarColor(name || "?");
    el.textContent = initials(name || "?");
  }
}

// Recorta a imagem num quadrado central e reduz pra `size`px — mantém o
// upload pequeno (data URL cabe fácil numa coluna de texto no banco) sem
// precisar de um bucket de storage externo pra uma foto de perfil.
function resizeImageToDataUrl(file, size) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

window.openProfileModal = function openProfileModal(me, onSaved) {
  const overlay = ensureProfileModalRoot();
  let pendingAvatarUrl = me.avatarUrl || null;

  const avatarEl = document.getElementById("profile-modal-avatar");
  const nameInput = document.getElementById("profile-modal-name");
  const photoInput = document.getElementById("profile-modal-photo-input");
  const photoBtn = document.getElementById("profile-modal-photo-btn");
  const saveBtn = document.getElementById("profile-modal-save");

  renderProfileAvatar(avatarEl, me.name, pendingAvatarUrl);
  nameInput.value = me.name || "";
  photoInput.value = "";
  overlay.classList.add("is-open");

  avatarEl.onclick = () => photoInput.click();
  photoBtn.onclick = () => photoInput.click();
  photoInput.onchange = async () => {
    const file = photoInput.files[0];
    if (!file) return;
    pendingAvatarUrl = await resizeImageToDataUrl(file, 160);
    renderProfileAvatar(avatarEl, nameInput.value, pendingAvatarUrl);
  };

  saveBtn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      await showAlertModal("Informe um nome.");
      return;
    }
    saveBtn.disabled = true;
    try {
      const res = await fetch("/api/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, avatarUrl: pendingAvatarUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        await showAlertModal(data?.error || "Erro ao salvar.");
        return;
      }
      closeProfileModal();
      onSaved(data);
    } finally {
      saveBtn.disabled = false;
    }
  };
};
