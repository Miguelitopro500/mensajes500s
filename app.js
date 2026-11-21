// Estado central único en memoria para evitar desincronización o mezclas viejas
const state = {
  currentUser: null,
  activeContactId: null,
  usersRegistry: [], // Simulación local antes de conectar directo a Supabase
  links: [],
  messages: []
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

// Registro o entrada verificando unicidad de usuario, contraseña y código de invitación
function handleAuthSubmit(event) {
  event.preventDefault();
  const username = dom.authUsername.value.trim().toLowerCase();
  const password = dom.authPassword.value;
  const inviteCode = dom.authInviteCode.value.trim().toUpperCase();

  if (!username || !password || !inviteCode) return;

  const existingByUser = state.usersRegistry.find(u => u.username === username);

  // Si el usuario ya existe, validar que coincidan contraseña y código exactos
  if (existingByUser) {
    if (existingByUser.password !== password || existingByUser.inviteCode !== inviteCode) {
      dom.authFeedback.textContent =
        "Ese usuario ya existe y sus datos no se pueden modificar. Verifica tus datos o crea otro usuario y código nuevos.";
      return;
    }
    existingByUser.online = true;
    existingByUser.lastSeen = new Date().toISOString();
    state.currentUser = existingByUser;
    dom.authFeedback.textContent = "";
    renderApp();
    return;
  }

  // Evitar que alguien use una contraseña o código de invitación ya registrados
  const codeTaken = state.usersRegistry.some(u => u.inviteCode === inviteCode);
  const passTaken = state.usersRegistry.some(u => u.password === password);
  if (codeTaken || passTaken) {
    dom.authFeedback.textContent =
      "Ese código de invitación o contraseña ya está registrado. Elige uno distinto.";
    return;
  }

  const newUser = {
    id: "usr-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    username,
    password,
    inviteCode,
    online: true,
    lastSeen: new Date().toISOString()
  };

  state.usersRegistry.push(newUser);
  state.currentUser = newUser;
  dom.authFeedback.textContent = "";
  showInAppToast("Cuenta creada", "Tus datos quedaron fijos y protegidos.");
  renderApp();
}

// Obtener contactos vinculados al usuario actual y verificar si son mutuos
function getMyContacts() {
  if (!state.currentUser) return [];
  const myId = state.currentUser.id;
  const outgoing = state.links.filter(l => l.fromUserId === myId);

  return outgoing
    .map(link => {
      const peer = state.usersRegistry.find(u => u.id === link.toUserId);
      if (!peer) return null;
      const isMutual = state.links.some(
        l => l.fromUserId === peer.id && l.toUserId === myId
      );
      return {
        id: peer.id,
        username: peer.username,
        online: peer.online,
        lastSeen: peer.lastSeen,
        isMutual
      };
    })
    .filter(Boolean);
}

// Añadir un contacto mediante su código privado (sin directorio público)
function handleAddContact(event) {
  event.preventDefault();
  if (!state.currentUser) return;

  const targetCode = dom.contactCodeInput.value.trim().toUpperCase();
  if (!targetCode) return;

  if (targetCode === state.currentUser.inviteCode) {
    showInAppToast("Código propio", "No puedes añadir tu propio código.");
    return;
  }

  const targetUser = state.usersRegistry.find(u => u.inviteCode === targetCode);
  if (!targetUser) {
    showInAppToast("Sin coincidencia", "No existe ningún usuario con ese código.");
    return;
  }

  const alreadyLinked = state.links.some(
    l => l.fromUserId === state.currentUser.id && l.toUserId === targetUser.id
  );
  if (!alreadyLinked) {
    state.links.push({
      fromUserId: state.currentUser.id,
      toUserId: targetUser.id
    });
  }

  state.activeContactId = targetUser.id;
  dom.contactCodeInput.value = "";
  showInAppToast("Vínculo registrado", `Contacto @${targetUser.username} añadido.`);
  renderApp();
}

// Enviar mensaje 1 a 1 únicamente si ambos se añadieron mutuamente
function handleSendMessage(event) {
  event.preventDefault();
  if (!state.currentUser || !state.activeContactId) return;

  const text = dom.messageInput.value.trim();
  if (!text) return;

  const myContacts = getMyContacts();
  const peer = myContacts.find(c => c.id === state.activeContactId);
  if (!peer || !peer.isMutual) return;

  state.messages.push({
    id: "msg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    senderId: state.currentUser.id,
    receiverId: peer.id,
    text,
    createdAt: new Date().toISOString()
  });

  dom.messageInput.value = "";
  renderApp();
}

// Renderizado completo desde la fuente única de verdad (state)
function renderApp() {
  const user = state.currentUser;
  const isLogged = Boolean(user);

  dom.authPanel.classList.toggle("hidden", isLogged);
  dom.sessionControls.classList.toggle("hidden", !isLogged);
  dom.contactsPanel.classList.toggle("hidden", !isLogged);
  dom.chatPanel.classList.toggle("hidden", !isLogged);

  if (!isLogged) return;

  dom.activeUserBadge.textContent = "@" + user.username;
  dom.myCodeBadge.textContent = "Código: " + user.inviteCode;

  const contacts = getMyContacts();
  dom.contactsList.innerHTML = "";

  if (contacts.length === 0) {
    dom.contactsList.innerHTML =
      `<p class="empty-msg">Sin contactos aún. Comparte tu código en persona y vincula el suyo.</p>`;
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
    )} también añada tu código (${escapeHtml(user.inviteCode)}) para habilitar el chat.</p>`;
    dom.messageForm.classList.add("hidden");
    return;
  }

  dom.messageForm.classList.remove("hidden");

  const conversation = state.messages.filter(
    m =>
      (m.senderId === user.id && m.receiverId === activePeer.id) ||
      (m.senderId === activePeer.id && m.receiverId === user.id)
  );

  if (conversation.length === 0) {
    dom.messagesList.innerHTML = `<p class="empty-msg">Chat privado listo. Escribe tu primer mensaje.</p>`;
  } else {
    dom.messagesList.innerHTML = conversation
      .map(m => {
        const mine = m.senderId === user.id;
        return `
          <div class="msg-bubble ${mine ? "mine" : "theirs"}">
            <div>${escapeHtml(m.text)}</div>
            <span class="msg-time">${formatExactTime(m.createdAt)}</span>
          </div>
        `;
      })
      .join("");
    dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
  }
}

// Salir de la sesión actual dejando los registros guardados intactos
function handleLogout() {
  if (state.currentUser) {
    state.currentUser.online = false;
    state.currentUser.lastSeen = new Date().toISOString();
  }
  state.currentUser = null;
  state.activeContactId = null;
  dom.authForm.reset();
  renderApp();
}

// Simular llegada de mensaje para probar el aviso interno y el chat mutuo
function handleTestIncoming() {
  if (!state.currentUser) return;
  const contacts = getMyContacts();
  const mutualPeer = contacts.find(c => c.isMutual);

  if (!mutualPeer) {
    showInAppToast(
      "Aviso de prueba",
      "Crea dos usuarios en esta misma pestaña y vincúlalos mutuamente para probar mensajes reales."
    );
    return;
  }

  const incomingText = "Mensaje recibido en tiempo real.";
  state.messages.push({
    id: "msg-in-" + Date.now(),
    senderId: mutualPeer.id,
    receiverId: state.currentUser.id,
    text: incomingText,
    createdAt: new Date().toISOString()
  });

  if (state.activeContactId === mutualPeer.id) {
    renderApp();
  }
  showInAppToast("@" + mutualPeer.username, incomingText, mutualPeer.id);
}

dom.authForm.addEventListener("submit", handleAuthSubmit);
dom.addContactForm.addEventListener("submit", handleAddContact);
dom.messageForm.addEventListener("submit", handleSendMessage);
dom.btnLogout.addEventListener("click", handleLogout);
dom.btnTestToast.addEventListener("click", handleTestIncoming);

renderApp();

