'use strict';

// ═══════════════════════════════════════════════════════
//  game.js — Lógica principal del juego en tiempo real
// ═══════════════════════════════════════════════════════

// ─── Recuperar sesión guardada por lobby.js ───────────
const sessionRaw = sessionStorage.getItem('bn_session');
if (!sessionRaw) {
  // Si no hay sesión, redirigir al inicio
  window.location.href = '/';
}

const session = JSON.parse(sessionRaw);
const { roomCode, playerId, nick, fleetConfig, boardSize } = session;

// ─── Socket ───────────────────────────────────────────
const socket = io();

// ─── Estado del juego ─────────────────────────────────
const gameState = {
  phase:          'waiting',  // 'placement' | 'playing' | 'finished'
  myId:           playerId,
  currentTurn:    null,
  pendingTargets: [],         // IDs de rivales a los que aún debo disparar esta ronda
  players:        {},         // playerId → { nick, grid, ships, alive }
  turnOrder:      [],
};

// ─── Referencias DOM ──────────────────────────────────
const els = {
  headerRoom:     document.getElementById('header-room'),
  headerNick:     document.getElementById('header-nick'),
  headerTurn:     document.getElementById('header-turn'),
  btnLeave:       document.getElementById('btn-leave'),
  // Fases
  phasePlacement: document.getElementById('phase-placement'),
  phaseGame:      document.getElementById('phase-game'),
  screenGameover: document.getElementById('screen-gameover'),
  screenWaiting:  document.getElementById('screen-waiting'),
  waitingMsg:     document.getElementById('waiting-message'),
  // Tablero propio
  ownBoard:       document.getElementById('own-board'),
  ownShipsLeft:   document.getElementById('own-ships-left'),
  // Tableros enemigos
  enemyBoards:    document.getElementById('enemy-boards-container'),
  // Chat
  eventLog:       document.getElementById('event-log'),
  chatInput:      document.getElementById('chat-input'),
  btnChatSend:    document.getElementById('btn-chat-send'),
  // Game over
  gameoverIcon:   document.getElementById('gameover-icon'),
  gameoverTitle:  document.getElementById('gameover-title'),
  gameoverMsg:    document.getElementById('gameover-message'),
  btnGameoverHome: document.getElementById('btn-gameover-home'),
};

// ─── Setup inicial ────────────────────────────────────
els.headerRoom.textContent = `Sala: ${roomCode}`;
els.headerNick.textContent = nick;
setWaiting('Conectando al servidor…');

// ─── Síntesis de voz ─────────────────────────────────
function speak(text) {
  if (!window.speechSynthesis) return;
  // Cancelar cualquier voz en curso
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang  = 'es-ES';
  utt.rate  = 0.95;
  utt.pitch = 1;
  // Intentar usar una voz en español si está disponible
  const voices = speechSynthesis.getVoices();
  const esVoice = voices.find(v => v.lang.startsWith('es'));
  if (esVoice) utt.voice = esVoice;
  speechSynthesis.speak(utt);
}

// Esperar a que las voces carguen (pueden tardar en algunos navegadores)
if (window.speechSynthesis) {
  speechSynthesis.getVoices(); // dispara la carga
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}
const btnMute = document.getElementById('btn-mute');
btnMute.addEventListener('click', () => {
  if (window.SoundFX) {
    const nowEnabled = !SoundFX.isEnabled();
    SoundFX.setEnabled(nowEnabled);
    btnMute.textContent = nowEnabled ? '🔊' : '🔇';
  }
});

// ─── Inicializar módulo de posicionamiento ────────────
// (placement.js debe cargarse primero en el HTML)
function initPlacement() {
  hideWaiting();
  // Solo inicializar una vez
  if (gameState.placementInit) return;
  gameState.placementInit = true;
  PlacementModule.init(socket, fleetConfig, boardSize, () => {
    // Callback: jugador marcó "listo" → mostrar spinner
    setWaiting('Esperando que los demás jugadores estén listos…');
  });
}

// ─── Registrarse en la sala al conectar ───────────────
// game.html abre una conexión WebSocket nueva. Debemos vincular
// este socket con la sala usando room:rejoin.
function rejoinRoom() {
  setWaiting('Conectando al servidor…');
  socket.emit('room:rejoin', { roomCode, nick }, (res) => {
    if (res?.error) {
      console.error('Error al reconectarse:', res.error);
      // La sala puede haber expirado; volver al inicio
      sessionStorage.removeItem('bn_session');
      window.location.href = '/';
      return;
    }

    // Actualizar el playerId con el nuevo socketId asignado por el servidor
    gameState.myId = res.playerId;
    // Actualizar también la sesión para que disparos usen el id correcto
    session.playerId = res.playerId;

    const roomPhase = res.roomState;

    if (roomPhase === 'placement') {
      gameState.phase = 'placement';
      els.phasePlacement.classList.remove('hidden');
      initPlacement();
      hideWaiting();
    } else if (roomPhase === 'playing') {
      gameState.phase = 'playing';
      els.phasePlacement.classList.add('hidden');
      els.phaseGame.classList.remove('hidden');
      hideWaiting();
      if (res.gameState) buildGameUI(res.gameState);
    } else {
      // Estado 'waiting': no debería llegar aquí, volver al lobby
      sessionStorage.removeItem('bn_session');
      window.location.href = '/';
    }
  });
}

// ═══════════════════════════════════════════════════════
//  CONSTRUCCIÓN DE TABLEROS
// ═══════════════════════════════════════════════════════

const BOARD_SIZE = boardSize || 10;

// Construir un tablero 10×10 con etiquetas y retornar el elemento raíz
function buildBoard(containerEl, options = {}) {
  containerEl.innerHTML = '';
  containerEl.classList.add('board');
  if (options.className) containerEl.classList.add(options.className);

  // Esquina vacía
  const corner = document.createElement('div');
  corner.className = 'board__corner';
  containerEl.appendChild(corner);

  // Etiquetas columnas
  for (let c = 0; c < BOARD_SIZE; c++) {
    const lbl = document.createElement('div');
    lbl.className = 'board__col-label';
    lbl.textContent = String.fromCharCode(65 + c);
    containerEl.appendChild(lbl);
  }

  // Filas + celdas
  for (let r = 0; r < BOARD_SIZE; r++) {
    const rowLbl = document.createElement('div');
    rowLbl.className = 'board__row-label';
    rowLbl.textContent = r + 1;
    containerEl.appendChild(rowLbl);

    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = document.createElement('div');
      cell.className  = 'board__cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      if (options.onCellClick) {
        cell.addEventListener('click', () => options.onCellClick(r, c, cell));
      }
      containerEl.appendChild(cell);
    }
  }
}

// Obtener celda de un tablero
function getCellEl(boardEl, row, col) {
  return boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
}

// Aplicar un estado de grid a un tablero visual
function applyGridToBoard(boardEl, grid, ships, options = {}) {
  // Construir mapa celda→shipId para colorear
  const cellShipMap = {};
  if (ships) {
    for (const ship of ships) {
      for (const { row, col } of ship.cells) {
        cellShipMap[`${row},${col}`] = ship.id;
      }
    }
  }

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell  = getCellEl(boardEl, r, c);
      if (!cell) continue;
      const value = grid[r][c];

      cell.classList.remove(
        'board__cell--ship', 'board__cell--hit',
        'board__cell--miss', 'board__cell--sunk'
      );
      cell.style.background  = '';
      cell.style.borderColor = '';
      cell.style.boxShadow   = '';

      if (value === 'ship') {
        cell.classList.add('board__cell--ship');
        // Aplicar color del barco correspondiente
        const shipId = cellShipMap[`${r},${c}`];
        if (shipId && window.ShipColors) {
          const color = ShipColors.getColor(shipId);
          const bg    = ShipColors.getBgColor(shipId);
          cell.style.borderColor = color;
          cell.style.background  = `linear-gradient(135deg, ${bg}, rgba(0,40,80,0.7))`;
          cell.style.boxShadow   = `inset 0 0 4px ${color}66`;
        }
      }
      if (value === 'miss')  cell.classList.add('board__cell--miss');
      if (value === 'hit')   cell.classList.add('board__cell--hit');
    }
  }

  // Marcar celdas de barcos hundidos
  if (ships) {
    for (const ship of ships) {
      if (ship.sunk) {
        for (const { row, col } of ship.cells) {
          const cell = getCellEl(boardEl, row, col);
          if (cell) {
            cell.classList.remove('board__cell--hit');
            cell.classList.add('board__cell--sunk');
            cell.style.background  = '';
            cell.style.borderColor = '';
            cell.style.boxShadow   = '';
          }
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════
//  FASE DE BATALLA — Construcción de UI
// ═══════════════════════════════════════════════════════

function buildGameUI(state) {
  // Tablero propio
  buildBoard(els.ownBoard, { className: 'board--own' });

  // Tableros enemigos: uno por cada oponente
  els.enemyBoards.innerHTML = '';
  for (const [pid, pdata] of Object.entries(state.players)) {
    if (pid === gameState.myId) continue;
    createEnemyBoardCard(pid, pdata);
  }

  applyFullState(state);
}

function createEnemyBoardCard(targetId, pdata) {
  const card = document.createElement('div');
  card.className = 'enemy-board-card';
  card.id        = `enemy-card-${targetId}`;

  const header = document.createElement('div');
  header.className = 'enemy-board-header';
  header.innerHTML = `
    <span class="enemy-nick">${escapeHtml(pdata.nick)}</span>
    <div style="display:flex;gap:0.5rem;align-items:center">
      <span class="enemy-ships-sunk" id="sunk-${targetId}"></span>
      <span class="enemy-status enemy-status--alive" id="status-${targetId}">Activo</span>
    </div>
  `;

  const boardContainer = document.createElement('div');
  boardContainer.id = `enemy-board-${targetId}`;

  buildBoard(boardContainer, {
    className: 'board--enemy',
    onCellClick: (row, col) => shoot(targetId, row, col),
  });

  card.appendChild(header);
  card.appendChild(boardContainer);
  els.enemyBoards.appendChild(card);
}

// ─── Aplicar estado completo del juego ────────────────
function applyFullState(state) {
  gameState.currentTurn    = state.currentTurn;
  gameState.players        = state.players;
  gameState.turnOrder      = state.turnOrder;
  gameState.pendingTargets = state.pendingTargets || [];

  const isMyTurn = state.currentTurn === gameState.myId;
  updateTurnBadge(isMyTurn);

  for (const [pid, pdata] of Object.entries(state.players)) {
    if (pid === gameState.myId) {
      applyGridToBoard(els.ownBoard, pdata.grid, pdata.ships);
      updateOwnShipsCounter(pdata.ships);
    } else {
      const boardEl = document.getElementById(`enemy-board-${pid}`);
      if (!boardEl) continue;
      applyGridToBoard(boardEl, pdata.grid, pdata.ships);
      updateEnemyCard(pid, pdata, isMyTurn);
    }
  }

  // Restaurar log de eventos
  if (state.eventLog) {
    for (const entry of state.eventLog) {
      if (!document.querySelector(`[data-ts="${entry.ts}"]`)) {
        addEvent(entry.message, entry.ts);
      }
    }
  }
}

function updateOwnShipsCounter(ships) {
  if (!ships) return;
  const total = ships.length;
  const sunk  = ships.filter(s => s.sunk).length;
  els.ownShipsLeft.textContent = `(${total - sunk}/${total} naves)`;
}

// Actualiza el badge "Tu turno" del header
function updateTurnBadge(isMyTurn) {
  if (isMyTurn) {
    const pending = gameState.pendingTargets.length;
    els.headerTurn.textContent = pending > 1
      ? `Tu turno · ${pending} disparos restantes`
      : 'Tu turno';
    els.headerTurn.classList.remove('hidden');
  } else {
    els.headerTurn.classList.add('hidden');
  }
}

function updateEnemyCard(targetId, pdata, isMyTurn) {
  const card      = document.getElementById(`enemy-card-${targetId}`);
  const statusEl  = document.getElementById(`status-${targetId}`);
  const sunkEl    = document.getElementById(`sunk-${targetId}`);
  const boardEl   = document.getElementById(`enemy-board-${targetId}`);
  if (!card) return;

  if (!pdata.alive) {
    card.classList.add('eliminated');
    if (statusEl) {
      statusEl.className   = 'enemy-status enemy-status--eliminated';
      statusEl.textContent = 'Eliminado';
    }
  } else {
    card.classList.remove('eliminated');
    if (statusEl) {
      statusEl.className   = 'enemy-status enemy-status--alive';
      statusEl.textContent = 'Activo';
    }
  }

  if (sunkEl && pdata.ships) {
    const sunk = pdata.ships.filter(s => s.sunk).length;
    sunkEl.textContent = sunk > 0 ? `💀 ${sunk} hundidas` : '';
  }

  // Es objetivo activo si: es mi turno, está vivo y aún no le disparé esta ronda
  const isPendingTarget = isMyTurn && pdata.alive &&
    gameState.pendingTargets.includes(targetId);

  if (boardEl) {
    boardEl.classList.toggle('board--not-turn', !isPendingTarget);
  }

  card.classList.toggle('active-target', isPendingTarget);
}

// ═══════════════════════════════════════════════════════
//  DISPARAR
// ═══════════════════════════════════════════════════════

function shoot(targetId, row, col) {
  if (gameState.currentTurn !== gameState.myId) return;
  const target = gameState.players[targetId];
  if (!target || !target.alive) return;
  // Solo permitir disparar a objetivos pendientes de esta ronda
  if (!gameState.pendingTargets.includes(targetId)) return;

  socket.emit('game:shoot', { targetId, row, col }, (res) => {
    if (res?.error) {
      addEvent(`⚠ ${res.error}`, null, 'error');
    }
  });
}

// ═══════════════════════════════════════════════════════
//  CHAT / LOG DE EVENTOS
// ═══════════════════════════════════════════════════════

const seenTimestamps = new Set();

function addEvent(message, ts = null, type = '') {
  // Evitar duplicados cuando se aplica el estado completo + eventos individuales
  const key = ts ? String(ts) : message;
  if (ts && seenTimestamps.has(key)) return;
  if (ts) seenTimestamps.add(key);

  const entry = document.createElement('div');
  entry.className = 'event-log__entry';
  if (ts) entry.dataset.ts = ts;

  // Clasificar visualmente
  const lower = message.toLowerCase();
  if (lower.includes('hundido') || lower.includes('eliminado')) {
    entry.classList.add('event-log__entry--sunk');
  } else if (lower.includes('impacto') || lower.includes('tocado')) {
    entry.classList.add('event-log__entry--hit');
  } else if (lower.includes('agua')) {
    entry.classList.add('event-log__entry--miss');
  } else if (message.startsWith('💬')) {
    entry.classList.add('event-log__entry--chat');
  }

  entry.textContent = message;
  els.eventLog.appendChild(entry);
  els.eventLog.scrollTop = els.eventLog.scrollHeight;
}

// Enviar mensaje de chat
function sendChat() {
  const text = els.chatInput.value.trim();
  if (!text) return;
  socket.emit('chat:message', { text });
  els.chatInput.value = '';
}

els.btnChatSend.addEventListener('click', sendChat);
els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

// ═══════════════════════════════════════════════════════
//  ANIMACIÓN DE IMPACTO
// ═══════════════════════════════════════════════════════

function animateShot(boardEl, row, col, result) {
  const cell = getCellEl(boardEl, row, col);
  if (!cell) return;

  cell.classList.remove(
    'board__cell--ship', 'board__cell--hit',
    'board__cell--miss', 'board__cell--sunk', 'board__cell--hit-new'
  );

  if (result === 'miss') {
    cell.classList.add('board__cell--miss');
  } else if (result === 'hit') {
    cell.classList.add('board__cell--hit', 'board__cell--hit-new');
    setTimeout(() => cell.classList.remove('board__cell--hit-new'), 400);
  } else if (result === 'sunk') {
    cell.classList.add('board__cell--sunk', 'board__cell--hit-new');
    setTimeout(() => cell.classList.remove('board__cell--hit-new'), 400);
  }
}

// ═══════════════════════════════════════════════════════
//  OVERLAYS
// ═══════════════════════════════════════════════════════

function setWaiting(msg) {
  els.waitingMsg.textContent = msg;
  els.screenWaiting.classList.remove('hidden');
}

function hideWaiting() {
  els.screenWaiting.classList.add('hidden');
}

function showGameOver(winner) {
  const isWinner = winner?.playerId === playerId;
  els.gameoverIcon.textContent  = isWinner ? '🏆' : '💀';
  els.gameoverTitle.textContent = isWinner ? '¡Victoria!' : 'Has sido derrotado';
  els.gameoverMsg.textContent   = winner
    ? `${winner.nick} ha ganado la batalla.`
    : 'La batalla ha terminado.';
  els.screenGameover.classList.remove('hidden');
}

els.btnGameoverHome.addEventListener('click', () => {
  sessionStorage.removeItem('bn_session');
  window.location.href = '/';
});

els.btnLeave.addEventListener('click', () => {
  if (confirm('¿Seguro que quieres abandonar la partida?')) {
    sessionStorage.removeItem('bn_session');
    window.location.href = '/';
  }
});

// ═══════════════════════════════════════════════════════
//  EVENTOS DE SOCKET
// ═══════════════════════════════════════════════════════

// Al conectar (primera vez o reconexión tras corte de red)
socket.on('connect', () => {
  rejoinRoom();
});

socket.on('disconnect', () => {
  setWaiting('Desconectado del servidor. Reconectando…');
});

// El servidor inicia la fase de posicionamiento para TODOS
// (ocurre cuando el host pulsa "Iniciar Partida" DESPUÉS de que este
//  socket ya está en la sala por room:rejoin, o cuando otro jugador
//  se une y el host inicia mientras estamos en placement)
socket.on('phase:placement', () => {
  if (gameState.phase === 'placement') return; // ya estamos
  gameState.phase = 'placement';
  els.phasePlacement.classList.remove('hidden');
  els.phaseGame.classList.add('hidden');
  initPlacement();
  hideWaiting();
});

// Servidor confirma inicio del juego
socket.on('phase:game', (data) => {
  gameState.phase       = 'playing';
  gameState.currentTurn = data.currentTurn;

  els.phasePlacement.classList.add('hidden');
  els.phaseGame.classList.remove('hidden');
  hideWaiting();

  if (window.SoundFX) SoundFX.battleStart();

  // El texto y la voz se emiten cuando llega game:state con los datos completos
  // (phase:game solo cambia la fase; game:state tiene players + pendingTargets)
  addEvent('⚓ ¡La batalla ha comenzado!');
});

// Estado completo del juego (sincronización tras reconexión)
// Es la fuente de verdad: siempre tiene currentTurn y pendingTargets correctos.
let gameStartAnnounced = false;
socket.on('game:state', (state) => {
  if (state.state !== 'playing') return;

  const wasPlaying = gameState.phase === 'playing';

  if (!wasPlaying) {
    // Primera vez que llegamos a estado playing → construir UI
    gameState.phase = 'playing';
    els.phasePlacement.classList.add('hidden');
    els.phaseGame.classList.remove('hidden');
    hideWaiting();
    buildGameUI(state);
  } else {
    applyFullState(state);
  }

  // Anuncio de inicio: solo una vez por partida
  if (!gameStartAnnounced) {
    gameStartAnnounced = true;
    const firstNick = state.players[state.currentTurn]?.nick || '???';
    const msg = `Comienza ${firstNick}`;

    // Texto en el log
    addEvent(`🎙 ${msg}`);

    // Voz
    setTimeout(() => speak(msg), 600);

    // Sonido + badge
    if (window.SoundFX) setTimeout(() => SoundFX.myTurn(), 1200);
    const isMyTurn = state.currentTurn === gameState.myId;
    if (isMyTurn) {
      addEvent(`🎯 ¡Es tu turno! Dispara a cada rival una vez.`);
    } else {
      addEvent(`🔄 Espera tu turno.`);
    }
  }
});

// Resultado de un disparo — solo anima y muestra mensajes.
// La actualización de pendingTargets/currentTurn viene con game:state.
socket.on('game:shot', (data) => {
  const { targetId, row, col, result, sunkShip,
          nextTurn, gameOver, roundComplete, pendingCount } = data;

  // ── Sonido ──
  if (window.SoundFX) {
    if (result === 'sunk')     SoundFX.shipSunk();
    else if (result === 'hit') SoundFX.shotHit();
    else                       SoundFX.shotMiss();
  }

  // ── Animar tablero ──
  if (targetId === gameState.myId) {
    animateShot(els.ownBoard, row, col, result);
    if (sunkShip) {
      for (const { row: r, col: c } of sunkShip.cells) {
        const cell = getCellEl(els.ownBoard, r, c);
        if (cell) { cell.classList.remove('board__cell--hit'); cell.classList.add('board__cell--sunk'); }
      }
    }
    if (!data.targetAlive && gameState.players[targetId]) {
      gameState.players[targetId].alive = false;
    }
  } else {
    const enemyBoardEl = document.getElementById(`enemy-board-${targetId}`);
    if (enemyBoardEl) {
      animateShot(enemyBoardEl, row, col, result);
      if (sunkShip) {
        for (const { row: r, col: c } of sunkShip.cells) {
          const cell = getCellEl(enemyBoardEl, r, c);
          if (cell) { cell.classList.remove('board__cell--hit'); cell.classList.add('board__cell--sunk'); }
        }
      }
    }
    if (!data.targetAlive && gameState.players[targetId]) {
      gameState.players[targetId].alive = false;
    }
  }

  // ── Mensajes y voz de turno ──
  if (!gameOver) {
    if (roundComplete) {
      const nextNick = gameState.players[nextTurn]?.nick || '???';
      if (nextTurn === gameState.myId) {
        setTimeout(() => { if (window.SoundFX) SoundFX.myTurn(); }, 400);
        setTimeout(() => speak('Ahora es tu turno'), 500);
        addEvent(`🎯 Ahora es tu turno, ${nick}. ¡Dispara a todos los rivales!`);
      } else {
        setTimeout(() => { if (window.SoundFX) SoundFX.turnChange(); }, 400);
        setTimeout(() => speak(`Turno de ${nextNick}`), 500);
        addEvent(`🔄 Ahora es el turno de ${nextNick}.`);
      }
    } else if (data.shooterId === gameState.myId && pendingCount > 0) {
      addEvent(`🎯 Te queda${pendingCount > 1 ? 'n ' + pendingCount + ' disparos' : ' 1 disparo'} esta ronda.`);
    }
  }
});

// Mensaje de evento / chat
socket.on('game:event', ({ message, ts }) => {
  addEvent(message, ts);
});

// Actualización de estado de posicionamiento del propio jugador
socket.on('placement:update', (ownerView) => {
  if (window.PlacementModule) PlacementModule.applyServerState(ownerView);
});

// Fin de partida
socket.on('game:over', ({ winner }) => {
  gameState.phase = 'finished';
  if (window.SoundFX) {
    if (winner?.playerId === gameState.myId) SoundFX.victory();
    else SoundFX.defeat();
  }
  showGameOver(winner);
});

// ─── Utilidades ───────────────────────────────────────
function getTurnNick(turnPlayerId) {
  return gameState.players[turnPlayerId]?.nick || '???';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
