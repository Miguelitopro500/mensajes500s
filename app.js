const SUPABASE_URL = "https://bqgamrdlwonagzuhexze.supabase.co";
const SUPABASE_KEY = "sb_publishable_lmNFaMxydkE4PJKzGZ3EUA_loekBsun";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Estado central sincronizado con Supabase (sin cachés locales viejos)
const state = {
  currentUser: null,
  activeContactId: null,
  accounts: [],
  links: [],
  messages: [],
  realtimeChannel: null
};

const dom = {
  toastContainer: document.getElementById("toast-container"),
  sessionControls: document.getElementById("session-controls"),
  activeUserBadge: document.getElementById("active-user-badge"),
  myCodeBadge: document.getElementById("my-code-badge"),
  btnTestToast: document.getElementById("btn-test-toast"),
  btnLogout: document.getElementById("btn-logout"),

  authPanel: document.getElementById("auth-panel"),
  authForm: document.getElementById("auth-form"),
  authUsername: document.getElementById("auth-username"),
  authPassword: document.getElementById("auth-password"),
  authInviteCode: document.getElementById("auth-invite-code"),
  authFeedback: document.getElementById("auth-feedback"),

  contactsPanel: document.getElementById("contacts-panel"),
  addContactForm: document.getElementById("add-contact-form"),
  contactCodeInput: document.getElementById("contact-code-input"),
  contactsList: document.getElementById("contacts-list"),

  chatPanel: document.getElementById("chat-panel"),
  chatPeerName: document.getElementById("chat-peer-name"),
  chatPeerPresence: document.getElementById("chat-peer-presence"),
  messagesList: document.getElementById("messages-list"),
  messageForm: document.getElementById("message-form"),
  messageInput: document.getElementById("message-input")
};

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatExactTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

// Aviso visual únicamente dentro de la pestaña abierta
function showInAppToast(title, body, contactId = null) {
  const item = document.createElement("div");
  item.className = "toast-item";
  item.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span>`;
  item.addEventListener("click", () => {
    if (contactId) {
      state.activeContactId = contactId;
      renderApp();
    }
    item.remove();
  });
  dom.toastContainer.appendChild(item);
  setTimeout(() => item.remove(), 4500);
}

// Cargar cuentas, vínculos y mensajes actuales desde Supabase
async function syncFromDatabase() {
  if (!state.currentUser) return;

  const [accRes, linkRes, msgRes] = await Promise.all([
    db.from("pulso_accounts").select("id, username, invite_code, is_online, last_seen"),
    db.from("pulso_links").select("id, from_user_id, to_user_id"),
    db
      .from("pulso_messages")
      .select("id, sender_id, receiver_id, content, created_at")
      .or(`sender_id.eq.${state.currentUser.id},receiver_id.eq.${state.currentUser.id}`)
      .order("created_at", { ascending: true })
  ]);

  if (!accRes.error && accRes.data) state.accounts = accRes.data;
  if (!linkRes.error && linkRes.data) state.links = linkRes.data;
  if (!msgRes.error && msgRes.data) state.messages = msgRes.data;

  const updatedMe = state.accounts.find(a => a.id === state.currentUser.id);
  if (updatedMe) {
    state.currentUser = { ...state.currentUser, ...updatedMe };
  }
}

// Suscripción en tiempo real para mensajes, vínculos y conexión
function subscribeRealtime() {
  if (state.realtimeChannel) {
    db.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
  if (!state.currentUser) return;

  const myId = state.currentUser.id;

  state.realtimeChannel = db
    .channel("pulso-live-" + myId)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pulso_accounts" },
      async () => {
        await syncFromDatabase();
        renderApp();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pulso_links" },
      async () => {
        await syncFromDatabase();
        renderApp();
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "pulso_messages" },
      async payload => {
        const row = payload.new;
        if (!row) return;
        if (row.sender_id !== myId && row.receiver_id !== myId) return;

        await syncFromDatabase();
        renderApp();

        if (row.sender_id !== myId) {
          const sender = state.accounts.find(a => a.id === row.sender_id);
          const senderLabel = sender ? "@" + sender.username : "Contacto";
          showInAppToast(senderLabel, row.content, row.sender_id);
        }
      }
    )
    .subscribe();
}

// Registro o entrada verificando unicidad e inmutabilidad en Supabase
async function handleAuthSubmit(event) {
  event.preventDefault();
  const username = dom.authUsername.value.trim().toLowerCase();
  const password = dom.authPassword.value;
  const inviteCode = dom.authInviteCode.value.trim().toUpperCase();

  if (!username || !password || !inviteCode) return;
  dom.authFeedback.textContent = "Verificando con la base de datos...";

  const { data: existingByUser, error: findErr } = await db
    .from("pulso_accounts")
    .select("*")
    .eq("username", username)
    .maybeSingle();

  if (findErr) {
    dom.authFeedback.textContent = "Error al consultar la base de datos: " + findErr.message;
    return;
  }

  // Si ya existe el usuario, validar contraseña y código exactos (no modificables)
  if (existingByUser) {
    if (existingByUser.password !== password || existingByUser.invite_code !== inviteCode) {
      dom.authFeedback.textContent =
        "Ese usuario ya existe y sus datos no se pueden modificar. Verifica tus datos o crea otro usuario y código nuevos.";
      return;
    }

    const nowIso = new Date().toISOString();
    await db
      .from("pulso_accounts")
      .update({ is_online: true, last_seen: nowIso })
      .eq("id", existingByUser.id);

    state.currentUser = { ...existingByUser, is_online: true, last_seen: nowIso };
    dom.authFeedback.textContent = "";
    await syncFromDatabase();
    subscribeRealtime();
    renderApp();
    return;
  }

  // Verificar que nadie más use ese código de invitación o esa contraseña
  const { data: dupCheck } = await db
    .from("pulso_accounts")
    .select("id, invite_code, password")
    .or(`invite_code.eq.${inviteCode},password.eq.${password}`);

  if (dupCheck && dupCheck.length > 0) {
    dom.authFeedback.textContent =
      "Ese código de invitación o contraseña ya está registrado. Elige uno distinto.";
    return;
  }

  const nowIso = new Date().toISOString();
  const { data: created, error: insErr } = await db
    .from("pulso_accounts")
    .insert({
      username,
      password,
      invite_code: inviteCode,
      is_online: true,
      last_seen: nowIso
    })
    .select()
    .single();

  if (insErr || !created) {
    dom.authFeedback.textContent =
      "No se pudo crear la cuenta. Revisa que el usuario, contraseña y código no estén repetidos.";
    return;
  }

  // Guardar registro histórico por si se crean cuentas adicionales en el futuro
  await db.from("pulso_account_history").insert({
    account_id: created.id,
    username: created.username,
    invite_code: created.invite_code
  });

  state.currentUser = created;
  dom.authFeedback.textContent = "";
  await syncFromDatabase();
  subscribeRealtime();
  showInAppToast("Cuenta creada", "Tus datos quedaron guardados y protegidos.");
  renderApp();
  localStorage.setItem("pulso_saved_user", JSON.stringify(state.currentUser));
}

// Obtener contactos vinculados al usuario actual y verificar si son mutuos
function getMyContacts() {
  if (!state.currentUser) return [];
  const myId = state.currentUser.id;
  const outgoing = state.links.filter(l => l.from_user_id === myId);

  return outgoing
    .map(link => {
      const peer = state.accounts.find(a => a.id === link.to_user_id);
      if (!peer) return null;
      const isMutual = state.links.some(
        l => l.from_user_id === peer.id && l.to_user_id === myId
      );
      return {
        id: peer.id,
        username: peer.username,
        online: Boolean(peer.is_online),
        lastSeen: peer.last_seen,
        isMutual
      };
    })
    .filter(Boolean);
}

// Añadir un contacto mediante su código privado en Supabase (sin directorio público)
async function handleAddContact(event) {
  event.preventDefault();
  if (!state.currentUser) return;

  const targetCode = dom.contactCodeInput.value.trim().toUpperCase();
  if (!targetCode) return;

  if (targetCode === state.currentUser.invite_code) {
    showInAppToast("Código propio", "No puedes añadir tu propio código.");
    return;
  }

  const { data: targetUser, error: findErr } = await db
    .from("pulso_accounts")
    .select("id, username, invite_code, is_online, last_seen")
    .eq("invite_code", targetCode)
    .maybeSingle();

  if (findErr || !targetUser) {
    showInAppToast("Sin coincidencia", "No existe ningún usuario con ese código.");
    return;
  }

  const alreadyLinked = state.links.some(
    l => l.from_user_id === state.currentUser.id && l.to_user_id === targetUser.id
  );

  if (!alreadyLinked) {
    const { error: linkErr } = await db.from("pulso_links").insert({
      from_user_id: state.currentUser.id,
      to_user_id: targetUser.id
    });
    if (linkErr) {
      showInAppToast("Error", "No se pudo registrar el vínculo.");
      return;
    }
  }

  state.activeContactId = targetUser.id;
  dom.contactCodeInput.value = "";
  await syncFromDatabase();
  showInAppToast("Vínculo registrado", `Contacto @${targetUser.username} añadido.`);
  renderApp();
}

// Enviar mensaje 1 a 1 en Supabase únicamente si ambos se añadieron mutuamente
async function handleSendMessage(event) {
  event.preventDefault();
  if (!state.currentUser || !state.activeContactId) return;

  const text = dom.messageInput.value.trim();
  if (!text) return;

  const myContacts = getMyContacts();
  const peer = myContacts.find(c => c.id === state.activeContactId);
  if (!peer || !peer.isMutual) return;

  dom.messageInput.value = "";

  const { data: inserted, error } = await db
    .from("pulso_messages")
    .insert({
      sender_id: state.currentUser.id,
      receiver_id: peer.id,
      content: text
    })
    .select()
    .single();

  if (error) {
    showInAppToast("Error de envío", "No se pudo enviar el mensaje.");
    return;
  }

  if (inserted && !state.messages.some(m => m.id === inserted.id)) {
    state.messages.push(inserted);
  }
  renderApp();
}

// Renderizado completo desde el estado sincronizado con Supabase
function renderApp() {
  const user = state.currentUser;
  const isLogged = Boolean(user);

  dom.authPanel.classList.toggle("hidden", isLogged);
  dom.sessionControls.classList.toggle("hidden", !isLogged);
  dom.contactsPanel.classList.toggle("hidden", !isLogged);
  dom.chatPanel.classList.toggle("hidden", !isLogged);

  if (!isLogged) return;

  dom.activeUserBadge.textContent = "@" + user.username;
  dom.myCodeBadge.textContent = "Código: " + user.invite_code;

  const contacts = getMyContacts();
  dom.contactsList.innerHTML = "";

  if (contacts.length === 0) {
    dom.contactsList.innerHTML =
      `<p class="empty-msg">Sin contactos aún. Comparte tu código y vincula el suyo.</p>`;
  } else {
    for (const contact of contacts) {
      const card = document.createElement("button");
      card.type = "button";
      card.className =
        "contact-card" + (contact.id === state.activeContactId ? " active" : "");

      const presenceText = contact.online
        ? "Conectado"
        : `Últ. conexión: ${formatExactTime(contact.lastSeen)}`;

      card.innerHTML = `
        <div class="contact-info">
          <strong>@${escapeHtml(contact.username)}</strong>
          <span class="contact-presence">${presenceText}</span>
        </div>
        <span class="contact-badge ${contact.isMutual ? "mutual" : ""}">
          ${contact.isMutual ? "Mutuo" : "Pendiente"}
        </span>
      `;

      card.addEventListener("click", () => {
        state.activeContactId = contact.id;
        renderApp();
      });

      dom.contactsList.appendChild(card);
    }
  }

  const activePeer = contacts.find(c => c.id === state.activeContactId);
  if (!activePeer) {
    dom.chatPeerName.textContent = "Sin contacto seleccionado";
    dom.chatPeerPresence.textContent = "";
    dom.messagesList.innerHTML =
      `<p class="empty-msg">Selecciona un contacto mutuo a la izquierda para conversar.</p>`;
    dom.messageForm.classList.add("hidden");
    return;
  }

  dom.chatPeerName.textContent = "@" + activePeer.username;
  dom.chatPeerPresence.textContent = activePeer.online
    ? "Conectado ahora"
    : `Última conexión: ${formatExactTime(activePeer.lastSeen)}`;

  if (!activePeer.isMutual) {
    dom.messagesList.innerHTML = `<p class="empty-msg">Esperando que @${escapeHtml(
      activePeer.username
    )} también añada tu código (${escapeHtml(user.invite_code)}) para habilitar el chat.</p>`;
    dom.messageForm.classList.add("hidden");
    return;
  }

  dom.messageForm.classList.remove("hidden");

  const conversation = state.messages.filter(
    m =>
      (m.sender_id === user.id && m.receiver_id === activePeer.id) ||
      (m.sender_id === activePeer.id && m.receiver_id === user.id)
  );

  if (conversation.length === 0) {
    dom.messagesList.innerHTML = `<p class="empty-msg">Chat privado listo. Escribe tu primer mensaje.</p>`;
  } else {
    dom.messagesList.innerHTML = conversation
      .map(m => {
        const mine = m.sender_id === user.id;
        return `
          <div class="msg-bubble ${mine ? "mine" : "theirs"}">
            <div>${escapeHtml(m.content)}</div>
            <span class="msg-time">${formatExactTime(m.created_at)}</span>
          </div>
        `;
      })
      .join("");
    dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
  }
}

// Cerrar sesión actualizando estado en Supabase sin borrar cuentas ni mensajes
async function handleLogout() {
  if (state.currentUser) {
    await db
      .from("pulso_accounts")
      .update({ is_online: false, last_seen: new Date().toISOString() })
      .eq("id", state.currentUser.id);
  }
  if (state.realtimeChannel) {
    db.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
  state.currentUser = null;
  state.activeContactId = null;
  state.accounts = [];
  state.links = [];
  state.messages = [];
  dom.authForm.reset();
  renderApp();
}

// Probar aviso visual dentro de la pestaña abierta
function handleTestIncoming() {
  if (!state.currentUser) return;
  const contacts = getMyContacts();
  const mutualPeer = contacts.find(c => c.isMutual);
  const label = mutualPeer ? "@" + mutualPeer.username : "Aviso de prueba";
  const targetId = mutualPeer ? mutualPeer.id : null;
  showInAppToast(label, "Aviso interno funcionando dentro de la pestaña.", targetId);
}

dom.authForm.addEventListener("submit", handleAuthSubmit);
dom.addContactForm.addEventListener("submit", handleAddContact);
dom.messageForm.addEventListener("submit", handleSendMessage);
dom.btnLogout.addEventListener("click", handleLogout);
dom.btnTestToast.addEventListener("click", handleTestIncoming);

const btnTogglePassword = document.getElementById("btn-toggle-password");
if (btnTogglePassword) {
  btnTogglePassword.addEventListener("click", () => {
    const hidden = dom.authPassword.type === "password";
    dom.authPassword.type = hidden ? "text" : "password";
    btnTogglePassword.textContent = hidden ? "Ocultar" : "Ver";
  });
}

const savedUser = localStorage.getItem("pulso_saved_user");
if (savedUser) {
  state.currentUser = JSON.parse(savedUser);
  syncFromDatabase().then(() => {
    subscribeRealtime();
    renderApp();
  });
} else {
  renderApp();
}

dom.authForm.addEventListener("submit", () => {
  let tries = 0;
  const checkLogin = setInterval(() => {
    tries++;
    if (state.currentUser) {
      localStorage.setItem("pulso_saved_user", JSON.stringify(state.currentUser));
      clearInterval(checkLogin);
    }
    if (tries >= 25) {
      clearInterval(checkLogin);
    }
  }, 200);
});

dom.btnLogout.addEventListener("click", () => {
  localStorage.removeItem("pulso_saved_user");
}, true);
