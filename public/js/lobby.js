'use strict';

// ═══════════════════════════════════════════════════════
//  lobby.js — Gestión del lobby / pantalla de inicio
// ═══════════════════════════════════════════════════════

const socket = io();

// ─── Estado local ────────────────────────────────────────
const state = {
  roomCode: null,
  playerId: null,
  nick:     null,
  isHost:   false,
  fleetConfig: null,
  boardSize:   null,
};

// ─── Referencias al DOM ──────────────────────────────────
const screens = {
  home:   document.getElementById('screen-home'),
  create: document.getElementById('screen-create'),
  join:   document.getElementById('screen-join'),
  lobby:  document.getElementById('screen-lobby'),
};

const els = {
  // Botones home
  btnCreate:    document.getElementById('btn-create'),
  btnJoinShow:  document.getElementById('btn-join-show'),
  // Crear sala
  inputNickCreate: document.getElementById('input-nick-create'),
  errorCreate:     document.getElementById('error-create'),
  btnBackCreate:   document.getElementById('btn-back-create'),
  btnDoCreate:     document.getElementById('btn-do-create'),
  // Unirse a sala
  inputNickJoin:   document.getElementById('input-nick-join'),
  inputRoomCode:   document.getElementById('input-room-code'),
  errorJoin:       document.getElementById('error-join'),
  btnBackJoin:     document.getElementById('btn-back-join'),
  btnDoJoin:       document.getElementById('btn-do-join'),
  // Lobby
  lobbyRoomCode:   document.getElementById('lobby-room-code'),
  btnCopyCode:     document.getElementById('btn-copy-code'),
  lobbyPlayerCount: document.getElementById('lobby-player-count'),
  lobbyPlayerList: document.getElementById('lobby-player-list'),
  lobbyEvents:     document.getElementById('lobby-events'),
  hostControls:    document.getElementById('host-controls'),
  guestWaiting:    document.getElementById('guest-waiting'),
  btnStartGame:    document.getElementById('btn-start-game'),
};

// ─── Utilidades ──────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function clearError(el) {
  el.classList.add('hidden');
  el.textContent = '';
}

// Colores por posición para los avatares
const AVATAR_COLORS = [
  '#00d4ff','#ffd700','#00e676','#ff6b6b',
  '#b39ddb','#ff8a65','#80cbc4','#f06292',
];

function addLobbyEvent(msg) {
  const entry = document.createElement('div');
  entry.className = 'event-log__entry';
  entry.textContent = msg;
  els.lobbyEvents.appendChild(entry);
  els.lobbyEvents.scrollTop = els.lobbyEvents.scrollHeight;
}

// ─── Renderizar lista de jugadores en el lobby ────────────
function renderPlayerList(players, hostId) {
  els.lobbyPlayerList.innerHTML = '';
  els.lobbyPlayerCount.textContent = players.length;

  players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'player-list__item';

    const avatarColor = AVATAR_COLORS[i % AVATAR_COLORS.length];
    const initial     = p.nick.charAt(0).toUpperCase();

    let badgeClass = 'badge--waiting';
    let badgeText  = 'Esperando';
    if (p.playerId === hostId) {
      badgeClass = 'badge--host';
      badgeText  = 'Host';
    } else if (p.ready) {
      badgeClass = 'badge--ready';
      badgeText  = 'Listo';
    }

    li.innerHTML = `
      <div class="player-avatar" style="background:${avatarColor}22;border:2px solid ${avatarColor};color:${avatarColor}">
        ${initial}
      </div>
      <span class="player-name">${escapeHtml(p.nick)}</span>
      <span class="player-badge ${badgeClass}">${badgeText}</span>
    `;
    els.lobbyPlayerList.appendChild(li);
  });

  // Habilitar botón de inicio si hay ≥2 jugadores
  if (state.isHost) {
    els.btnStartGame.disabled = players.length < 2;
  }
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Navegar a game.html pasando datos por sessionStorage ─
function goToGame() {
  sessionStorage.setItem('bn_session', JSON.stringify({
    roomCode:    state.roomCode,
    playerId:    state.playerId,
    nick:        state.nick,
    isHost:      state.isHost,
    fleetConfig: state.fleetConfig,
    boardSize:   state.boardSize,
  }));
  window.location.href = '/game';
}

// ─── Eventos de botones: Home ─────────────────────────────
els.btnCreate.addEventListener('click', () => showScreen('create'));

els.btnJoinShow.addEventListener('click', () => showScreen('join'));

// ─── Eventos de botones: Crear sala ──────────────────────
els.btnBackCreate.addEventListener('click', () => {
  clearError(els.errorCreate);
  showScreen('home');
});

els.btnDoCreate.addEventListener('click', createRoom);
els.inputNickCreate.addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });

function createRoom() {
  const nick = els.inputNickCreate.value.trim();
  if (!nick || nick.length < 2) {
    return showError(els.errorCreate, 'El nick debe tener al menos 2 caracteres.');
  }

  els.btnDoCreate.disabled = true;
  els.btnDoCreate.textContent = 'Creando…';

  socket.emit('room:create', { nick }, (res) => {
    els.btnDoCreate.disabled = false;
    els.btnDoCreate.textContent = 'Crear Sala';

    if (res.error) return showError(els.errorCreate, res.error);

    state.roomCode   = res.roomCode;
    state.playerId   = res.playerId;
    state.nick       = res.nick;
    state.isHost     = true;
    state.fleetConfig = res.fleetConfig;
    state.boardSize   = res.boardSize;

    showScreen('lobby');
    els.lobbyRoomCode.textContent = res.roomCode;
    els.hostControls.classList.remove('hidden');
    els.guestWaiting.classList.add('hidden');
    addLobbyEvent(`Sala ${res.roomCode} creada. Comparte el código con tus amigos.`);
  });
}

// ─── Eventos de botones: Unirse ───────────────────────────
els.btnBackJoin.addEventListener('click', () => {
  clearError(els.errorJoin);
  showScreen('home');
});

els.btnDoJoin.addEventListener('click', joinRoom);
els.inputRoomCode.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
els.inputNickJoin.addEventListener('keydown',  e => { if (e.key === 'Enter') joinRoom(); });

// Forzar mayúsculas en el campo de código
els.inputRoomCode.addEventListener('input', () => {
  const pos = els.inputRoomCode.selectionStart;
  els.inputRoomCode.value = els.inputRoomCode.value.toUpperCase();
  els.inputRoomCode.setSelectionRange(pos, pos);
});

function joinRoom() {
  const nick = els.inputNickJoin.value.trim();
  const code = els.inputRoomCode.value.trim().toUpperCase();

  if (!nick || nick.length < 2) {
    return showError(els.errorJoin, 'El nick debe tener al menos 2 caracteres.');
  }
  if (!code || code.length !== 6) {
    return showError(els.errorJoin, 'El código de sala debe tener 6 caracteres.');
  }

  els.btnDoJoin.disabled = true;
  els.btnDoJoin.textContent = 'Uniéndose…';

  socket.emit('room:join', { nick, roomCode: code }, (res) => {
    els.btnDoJoin.disabled = false;
    els.btnDoJoin.textContent = 'Unirse';

    if (res.error) return showError(els.errorJoin, res.error);

    state.roomCode   = res.roomCode;
    state.playerId   = res.playerId;
    state.nick       = res.nick;
    state.isHost     = false;
    state.fleetConfig = res.fleetConfig;
    state.boardSize   = res.boardSize;

    showScreen('lobby');
    els.lobbyRoomCode.textContent = res.roomCode;
    els.hostControls.classList.add('hidden');
    els.guestWaiting.classList.remove('hidden');
  });
}

// ─── Lobby: copiar código ─────────────────────────────────
els.btnCopyCode.addEventListener('click', () => {
  navigator.clipboard.writeText(state.roomCode).then(() => {
    els.btnCopyCode.textContent = '✅';
    setTimeout(() => { els.btnCopyCode.textContent = '📋'; }, 1500);
  });
});

// ─── Lobby: iniciar partida (host) ────────────────────────
els.btnStartGame.addEventListener('click', () => {
  els.btnStartGame.disabled = true;
  socket.emit('room:startPlacement', {}, (res) => {
    if (res?.error) {
      showError(els.errorCreate, res.error);
      els.btnStartGame.disabled = false;
    }
    // La navegación ocurre al recibir 'phase:placement'
  });
});

// ─── Eventos del servidor: Lobby ──────────────────────────
socket.on('lobby:update', (data) => {
  if (data.state === 'waiting') {
    renderPlayerList(data.players, data.hostId);
  }
});

socket.on('game:event', ({ message }) => {
  addLobbyEvent(message);
});

// Cuando el servidor avisa que empieza la fase de posicionamiento
socket.on('phase:placement', () => {
  goToGame();
});

// ─── Reconexión / errores de socket ──────────────────────
socket.on('disconnect', () => {
  addLobbyEvent('⚠ Desconectado del servidor. Intentando reconectar…');
});

socket.on('connect', () => {
  if (state.roomCode) {
    addLobbyEvent('✅ Reconectado al servidor.');
  }
});
