'use strict';

// Configuración de la flota: [cantidad, tamaño]
const FLEET_CONFIG = [
  { size: 4, count: 1 },
  { size: 3, count: 2 },
  { size: 2, count: 3 },
  { size: 1, count: 4 },
];

const BOARD_SIZE = 10;
const STATES = {
  WAITING:    'waiting',    // sala abierta, esperando jugadores
  PLACEMENT:  'placement',  // todos colocan sus barcos
  PLAYING:    'playing',    // partida en curso
  FINISHED:   'finished',   // partida terminada
};

class PlayerBoard {
  constructor(playerId, nick) {
    this.playerId = playerId;
    this.nick     = nick;
    // Matriz 10x10: null = agua, 'ship' = barco, 'hit' = impacto, 'miss' = agua disparada
    this.grid    = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
    this.ships   = [];   // [{ id, size, cells:[{row,col}], hits:0, sunk:false }]
    this.ready   = false;
    this.alive   = true;
  }

  // Valida y coloca una nave. Devuelve true si OK, mensaje de error si falla.
  placeShip(shipId, size, cells) {
    // 1. Verificar número correcto de celdas
    if (cells.length !== size) return 'Número de celdas incorrecto.';

    // 2. Verificar que estén en línea recta (horizontal o vertical)
    const rows = cells.map(c => c.row);
    const cols = cells.map(c => c.col);
    const allSameRow = rows.every(r => r === rows[0]);
    const allSameCol = cols.every(c => c === cols[0]);
    if (!allSameRow && !allSameCol) return 'Las celdas deben estar en línea recta.';

    // 3. Verificar que sean consecutivas
    if (allSameRow) {
      const sorted = [...cols].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) return 'Las celdas deben ser contiguas.';
      }
    } else {
      const sorted = [...rows].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) return 'Las celdas deben ser contiguas.';
      }
    }

    // 4. Verificar que estén dentro del tablero
    for (const { row, col } of cells) {
      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
        return 'Fuera del tablero.';
      }
    }

    // 5. Verificar colisión directa: ninguna celda de esta nave puede solapar con otra ya colocada
    for (const { row, col } of cells) {
      if (this.grid[row][col] !== null) return 'Esa celda ya está ocupada por otra nave.';
    }

    // 6. Registrar en la grid y en la lista de barcos
    for (const { row, col } of cells) {
      this.grid[row][col] = 'ship';
    }
    this.ships.push({ id: shipId, size, cells, hits: 0, sunk: false });
    return true;
  }

  // Elimina una nave ya colocada (para reposicionarla)
  removeShip(shipId) {
    const idx = this.ships.findIndex(s => s.id === shipId);
    if (idx === -1) return false;
    const ship = this.ships[idx];
    for (const { row, col } of ship.cells) {
      this.grid[row][col] = null;
    }
    this.ships.splice(idx, 1);
    return true;
  }

  // Valida que la flota completa esté colocada
  validateFleet() {
    for (const { size, count } of FLEET_CONFIG) {
      const placed = this.ships.filter(s => s.size === size).length;
      if (placed !== count) {
        return `Faltan naves de tamaño ${size}. Tienes ${placed} de ${count}.`;
      }
    }
    return true;
  }

  // Recibe un disparo. Devuelve { result: 'miss'|'hit'|'sunk', shipId?, sunkShip? }
  receiveShot(row, col) {
    const cell = this.grid[row][col];
    if (cell === 'hit' || cell === 'miss') return { result: 'already_shot' };

    const ship = this.ships.find(s => s.cells.some(c => c.row === row && c.col === col));
    if (!ship) {
      this.grid[row][col] = 'miss';
      return { result: 'miss' };
    }

    this.grid[row][col] = 'hit';
    ship.hits++;
    if (ship.hits === ship.size) {
      ship.sunk = true;
      // Comprobar si el jugador fue eliminado
      const allSunk = this.ships.every(s => s.sunk);
      if (allSunk) this.alive = false;
      return { result: 'sunk', shipId: ship.id, sunkShip: ship };
    }
    return { result: 'hit', shipId: ship.id };
  }

  // Vista segura para enviar al dueño (muestra sus propias naves)
  toOwnerView() {
    return {
      playerId: this.playerId,
      nick:     this.nick,
      grid:     this.grid,
      ships:    this.ships,
      ready:    this.ready,
      alive:    this.alive,
    };
  }

  // Vista para enemigos: oculta la posición de los barcos no hundidos
  toEnemyView() {
    const maskedGrid = this.grid.map(row =>
      row.map(cell => {
        if (cell === 'ship') return null;   // ocultar barcos intactos
        return cell;                         // null (agua), 'hit', 'miss' son visibles
      })
    );
    const visibleShips = this.ships
      .filter(s => s.sunk)
      .map(s => ({ id: s.id, size: s.size, cells: s.cells, sunk: true }));

    return {
      playerId: this.playerId,
      nick:     this.nick,
      grid:     maskedGrid,
      ships:    visibleShips,
      ready:    this.ready,
      alive:    this.alive,
    };
  }
}

// ─── Clase principal de la sala ───────────────────────────────────────────────
class GameRoom {
  constructor(roomCode, hostId, hostNick) {
    this.roomCode  = roomCode;
    this.state     = STATES.WAITING;
    this.hostId    = hostId;
    this.players   = new Map();  // socketId → PlayerBoard
    this.turnOrder = [];         // array de socketIds en orden
    this.turnIndex = 0;
    this.eventLog  = [];         // historial de eventos
    this.createdAt = Date.now();

    this.addPlayer(hostId, hostNick);
  }

  // ─── Gestión de jugadores ───────────────────────────────────────────────────

  addPlayer(socketId, nick) {
    if (this.players.has(socketId)) return false;
    if (this.state !== STATES.WAITING) return 'La partida ya comenzó.';
    // Nick único
    const nickTaken = [...this.players.values()].some(p => p.nick === nick);
    if (nickTaken) return 'Ese nick ya está en uso en esta sala.';

    this.players.set(socketId, new PlayerBoard(socketId, nick));
    return true;
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    // Actualizar el orden de turnos si la partida está en curso
    this.turnOrder = this.turnOrder.filter(id => id !== socketId);
    if (this.turnIndex >= this.turnOrder.length) this.turnIndex = 0;
  }

  getPlayer(socketId) {
    return this.players.get(socketId);
  }

  getLobbyInfo() {
    return {
      roomCode: this.roomCode,
      state:    this.state,
      hostId:   this.hostId,
      players:  [...this.players.values()].map(p => ({
        playerId: p.playerId,
        nick:     p.nick,
        ready:    p.ready,
      })),
    };
  }

  // ─── Fase de posicionamiento ────────────────────────────────────────────────

  startPlacement() {
    if (this.state !== STATES.WAITING) return 'Estado incorrecto para iniciar posicionamiento.';
    if (this.players.size < 2) return 'Se necesitan al menos 2 jugadores.';
    this.state = STATES.PLACEMENT;
    return true;
  }

  placeShip(socketId, shipId, size, cells) {
    if (this.state !== STATES.PLACEMENT) return 'No es la fase de posicionamiento.';
    const player = this.players.get(socketId);
    if (!player) return 'Jugador no encontrado.';
    return player.placeShip(shipId, size, cells);
  }

  removeShip(socketId, shipId) {
    if (this.state !== STATES.PLACEMENT) return false;
    const player = this.players.get(socketId);
    if (!player) return false;
    return player.removeShip(shipId);
  }

  setReady(socketId) {
    if (this.state !== STATES.PLACEMENT) return 'No es la fase de posicionamiento.';
    const player = this.players.get(socketId);
    if (!player) return 'Jugador no encontrado.';

    const valid = player.validateFleet();
    if (valid !== true) return valid;

    player.ready = true;

    // Si todos están listos, iniciar la partida
    const allReady = [...this.players.values()].every(p => p.ready);
    if (allReady) return { allReady: true };
    return { allReady: false };
  }

  // ─── Fase de juego ──────────────────────────────────────────────────────────

  startGame() {
    if (this.state !== STATES.PLACEMENT) return 'Estado incorrecto para iniciar el juego.';
    this.state = STATES.PLAYING;
    // Orden de turnos aleatorio
    this.turnOrder = [...this.players.keys()].sort(() => Math.random() - 0.5);
    this.turnIndex = 0;
    // Inicializar los disparos pendientes de la primera ronda
    this._resetRoundShots();
    return true;
  }

  // Inicializa/resetea el set de rivales a los que el jugador activo
  // aún no ha disparado en esta ronda.
  _resetRoundShots() {
    const shooterId = this.getCurrentTurnPlayerId();
    if (!shooterId) return;
    this.pendingTargets = new Set(
      [...this.players.keys()].filter(id =>
        id !== shooterId && this.players.get(id)?.alive
      )
    );
  }

  getCurrentTurnPlayerId() {
    return this.turnOrder[this.turnIndex] || null;
  }

  shoot(shooterId, targetId, row, col) {
    if (this.state !== STATES.PLAYING) return { error: 'La partida no está en curso.' };

    // Verificar que es el turno del atacante
    if (this.getCurrentTurnPlayerId() !== shooterId) {
      return { error: 'No es tu turno.' };
    }

    // No puedes dispararte a ti mismo
    if (shooterId === targetId) return { error: 'No puedes dispararte a ti mismo.' };

    const target = this.players.get(targetId);
    if (!target) return { error: 'Objetivo no encontrado.' };
    if (!target.alive) return { error: 'Ese jugador ya fue eliminado.' };

    // Verificar que este rival todavía está pendiente en la ronda actual
    if (!this.pendingTargets.has(targetId)) {
      return { error: 'Ya disparaste a ese jugador en esta ronda.' };
    }

    const shooter    = this.players.get(shooterId);
    const shotResult = target.receiveShot(row, col);

    if (shotResult.result === 'already_shot') {
      return { error: 'Ya disparaste a esa casilla.' };
    }

    const colLabel = String.fromCharCode(65 + col);
    const coord    = `${colLabel}${row + 1}`;

    let message = '';
    if (shotResult.result === 'miss') {
      message = `${shooter.nick} disparó a ${target.nick} en ${coord}: Agua.`;
    } else if (shotResult.result === 'hit') {
      message = `${shooter.nick} disparó a ${target.nick} en ${coord}: ¡Impacto!`;
    } else if (shotResult.result === 'sunk') {
      message = `${shooter.nick} disparó a ${target.nick} en ${coord}: ¡Hundido! (nave de ${shotResult.sunkShip.size} casillas)`;
      if (!target.alive) {
        message += ` — ${target.nick} ha sido eliminado.`;
      }
    }

    this.eventLog.push({ ts: Date.now(), message });

    // Marcar este objetivo como disparado en la ronda
    this.pendingTargets.delete(targetId);

    // Si el objetivo fue eliminado, quitarlo también de futuros pendingTargets
    if (!target.alive) {
      this.pendingTargets.delete(targetId);
    }

    // Verificar fin de partida (solo queda un jugador vivo)
    const alivePlayers = [...this.players.values()].filter(p => p.alive);
    let gameOver = false;
    let winner   = null;
    if (alivePlayers.length === 1) {
      gameOver = true;
      winner   = alivePlayers[0];
      this.state = STATES.FINISHED;
    }

    // ¿Quedan rivales vivos a los que disparar esta ronda?
    // Filtrar pendingTargets para eliminar los que ya no están vivos
    for (const id of this.pendingTargets) {
      if (!this.players.get(id)?.alive) this.pendingTargets.delete(id);
    }

    let roundComplete = false;
    if (!gameOver && this.pendingTargets.size === 0) {
      // Ronda completa → pasar al siguiente jugador vivo
      roundComplete = true;
      this._advanceTurn();
      this._resetRoundShots();
    }

    return {
      result:        shotResult.result,
      shooterId,
      targetId,
      row,
      col,
      coord,
      message,
      sunkShip:      shotResult.sunkShip || null,
      targetAlive:   target.alive,
      gameOver,
      winner:        winner ? { playerId: winner.playerId, nick: winner.nick } : null,
      nextTurn:      this.getCurrentTurnPlayerId(),
      roundComplete,
      // Cuántos rivales le quedan por disparar al jugador actual esta ronda
      pendingCount:  this.pendingTargets.size,
    };
  }

  _advanceTurn() {
    // Saltar jugadores eliminados
    let attempts = 0;
    do {
      this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
      attempts++;
    } while (
      !this.players.get(this.turnOrder[this.turnIndex])?.alive &&
      attempts < this.turnOrder.length
    );
  }

  // ─── Vistas del estado del juego ───────────────────────────────────────────

  // Estado completo para un jugador específico (propias naves visibles, enemigas ocultas)
  getStateForPlayer(socketId) {
    const views = {};
    for (const [id, board] of this.players) {
      views[id] = (id === socketId) ? board.toOwnerView() : board.toEnemyView();
    }
    return {
      roomCode:      this.roomCode,
      state:         this.state,
      players:       views,
      turnOrder:     this.turnOrder,
      currentTurn:   this.getCurrentTurnPlayerId(),
      // IDs de rivales a los que el jugador activo aún NO ha disparado esta ronda
      pendingTargets: socketId === this.getCurrentTurnPlayerId()
        ? [...(this.pendingTargets || [])]
        : [],
      eventLog:      this.eventLog.slice(-50),
    };
  }
}

module.exports = { GameRoom, FLEET_CONFIG, BOARD_SIZE, STATES };
