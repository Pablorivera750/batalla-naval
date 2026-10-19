'use strict';

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');
const { v4: uuidv4 } = require('uuid');
const { GameRoom, FLEET_CONFIG, BOARD_SIZE } = require('./src/GameRoom');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const PORT = process.env.PORT || 3000;

// ─── Servir archivos estáticos ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

// ─── Estado global del servidor ────────────────────────────────────────────
// roomCode → GameRoom
const rooms = new Map();
// socketId → { roomCode, nick }
const socketMeta = new Map();

// Generar código de sala de 6 caracteres
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// Emitir el lobby actualizado a todos en la sala
function broadcastLobby(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  io.to(roomCode).emit('lobby:update', room.getLobbyInfo());
}

// Emitir el estado del juego a cada jugador con su vista personalizada
function broadcastGameState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const [socketId] of room.players) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('game:state', room.getStateForPlayer(socketId));
    }
  }
}

// Emitir mensaje de chat/evento a toda la sala
function broadcastEvent(roomCode, message) {
  io.to(roomCode).emit('game:event', { message, ts: Date.now() });
}

// ─── Conexión de Socket.io ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Conectado: ${socket.id}`);

  // ── Crear sala ──────────────────────────────────────────────────────────
  socket.on('room:create', ({ nick }, callback) => {
    if (!nick || nick.trim().length < 2) {
      return callback({ error: 'El nick debe tener al menos 2 caracteres.' });
    }
    nick = nick.trim().substring(0, 20);

    const roomCode = generateRoomCode();
    const room     = new GameRoom(roomCode, socket.id, nick);
    rooms.set(roomCode, room);
    socketMeta.set(socket.id, { roomCode, nick });

    socket.join(roomCode);
    console.log(`[+] Sala creada: ${roomCode} por ${nick}`);
    callback({ roomCode, playerId: socket.id, nick, fleetConfig: FLEET_CONFIG, boardSize: BOARD_SIZE });
    broadcastLobby(roomCode);
  });

  // ── Unirse a sala ────────────────────────────────────────────────────────
  socket.on('room:join', ({ roomCode, nick }, callback) => {
    if (!nick || nick.trim().length < 2) {
      return callback({ error: 'El nick debe tener al menos 2 caracteres.' });
    }
    nick = nick.trim().substring(0, 20);
    roomCode = (roomCode || '').trim().toUpperCase();

    const room = rooms.get(roomCode);
    if (!room) return callback({ error: 'Sala no encontrada.' });
    if (room.state !== 'waiting') return callback({ error: 'La partida ya está en curso.' });
    if (room.players.size >= 6) return callback({ error: 'La sala está llena (máx. 6 jugadores).' });

    const result = room.addPlayer(socket.id, nick);
    if (result !== true) return callback({ error: result });

    socketMeta.set(socket.id, { roomCode, nick });
    socket.join(roomCode);

    console.log(`[+] ${nick} se unió a la sala ${roomCode}`);
    callback({ roomCode, playerId: socket.id, nick, fleetConfig: FLEET_CONFIG, boardSize: BOARD_SIZE });
    broadcastLobby(roomCode);
    broadcastEvent(roomCode, `${nick} se ha unido a la sala.`);
  });

  // ── Host inicia la fase de posicionamiento ──────────────────────────────
  socket.on('room:startPlacement', (_, callback) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return callback?.({ error: 'No estás en ninguna sala.' });

    const room = rooms.get(meta.roomCode);
    if (!room) return callback?.({ error: 'Sala no encontrada.' });
    if (room.hostId !== socket.id) return callback?.({ error: 'Solo el host puede iniciar la partida.' });

    const result = room.startPlacement();
    if (result !== true) return callback?.({ error: result });

    console.log(`[~] Sala ${meta.roomCode}: fase de posicionamiento`);
    io.to(meta.roomCode).emit('phase:placement', {
      fleetConfig: FLEET_CONFIG,
      boardSize:   BOARD_SIZE,
    });
    callback?.({ ok: true });
  });

  // ── Colocar nave ─────────────────────────────────────────────────────────
  socket.on('ship:place', ({ shipId, size, cells }, callback) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return callback?.({ error: 'No estás en ninguna sala.' });

    const room = rooms.get(meta.roomCode);
    if (!room) return callback?.({ error: 'Sala no encontrada.' });

    const result = room.placeShip(socket.id, shipId, size, cells);
    if (result !== true) return callback?.({ error: result });

    // Enviar estado actualizado solo al propio jugador
    socket.emit('placement:update', room.getPlayer(socket.id).toOwnerView());
    callback?.({ ok: true });
  });

  // ── Quitar nave ───────────────────────────────────────────────────────────
  socket.on('ship:remove', ({ shipId }, callback) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return callback?.({ error: 'No estás en ninguna sala.' });

    const room = rooms.get(meta.roomCode);
    if (!room) return callback?.({ error: 'Sala no encontrada.' });

    const ok = room.removeShip(socket.id, shipId);
    if (!ok) return callback?.({ error: 'No se pudo eliminar la nave.' });

    socket.emit('placement:update', room.getPlayer(socket.id).toOwnerView());
    callback?.({ ok: true });
  });

  // ── Jugador confirma que está listo ──────────────────────────────────────
  socket.on('player:ready', (_, callback) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return callback?.({ error: 'No estás en ninguna sala.' });

    const room = rooms.get(meta.roomCode);
    if (!room) return callback?.({ error: 'Sala no encontrada.' });

    const result = room.setReady(socket.id);
    if (typeof result === 'string') return callback?.({ error: result });

    const player = room.getPlayer(socket.id);
    broadcastEvent(meta.roomCode, `${player.nick} está listo.`);
    broadcastLobby(meta.roomCode);
    callback?.({ ok: true });

    if (result.allReady) {
      // Iniciar la partida
      room.startGame();
      console.log(`[~] Sala ${meta.roomCode}: partida iniciada`);
      broadcastEvent(meta.roomCode, '¡La batalla comienza!');
      broadcastGameState(meta.roomCode);
      io.to(meta.roomCode).emit('phase:game', { currentTurn: room.getCurrentTurnPlayerId() });
    }
  });

  // ── Disparo ──────────────────────────────────────────────────────────────
  socket.on('game:shoot', ({ targetId, row, col }, callback) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return callback?.({ error: 'No estás en ninguna sala.' });

    const room = rooms.get(meta.roomCode);
    if (!room) return callback?.({ error: 'Sala no encontrada.' });

    const shotData = room.shoot(socket.id, targetId, row, col);
    if (shotData.error) return callback?.({ error: shotData.error });

    callback?.({ ok: true });

    // Emitir el disparo a todos en la sala
    io.to(meta.roomCode).emit('game:shot', shotData);

    // Emitir el evento de chat
    broadcastEvent(meta.roomCode, shotData.message);

    // Actualizar el estado del juego para cada jugador
    broadcastGameState(meta.roomCode);

    if (shotData.gameOver) {
      console.log(`[✓] Sala ${meta.roomCode}: partida terminada. Ganador: ${shotData.winner?.nick}`);
      io.to(meta.roomCode).emit('game:over', { winner: shotData.winner });
    }
  });

  // ── Re-unirse tras navegación (lobby → game.html) ────────────────────────
  // El navegador abre una nueva conexión WebSocket al cargar game.html.
  // Este evento vincula el nuevo socketId con la sala y el nick guardados.
  socket.on('room:rejoin', ({ roomCode, nick }, callback) => {
    roomCode = (roomCode || '').trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return callback?.({ error: 'Sala no encontrada.' });

    // Buscar al jugador por nick (el socketId anterior ya no existe)
    let existingPlayer = null;
    let oldSocketId    = null;
    for (const [sid, player] of room.players) {
      if (player.nick === nick) {
        existingPlayer = player;
        oldSocketId    = sid;
        break;
      }
    }

    if (!existingPlayer) return callback?.({ error: 'Jugador no encontrado en la sala.' });

    // Reasignar el socketId al jugador existente
    if (oldSocketId !== socket.id) {
      room.players.delete(oldSocketId);
      existingPlayer.playerId = socket.id;
      room.players.set(socket.id, existingPlayer);

      // Actualizar el orden de turnos si aplica
      const turnIdx = room.turnOrder.indexOf(oldSocketId);
      if (turnIdx !== -1) room.turnOrder[turnIdx] = socket.id;

      // Actualizar host si era el host
      if (room.hostId === oldSocketId) room.hostId = socket.id;
    }

    socketMeta.set(socket.id, { roomCode, nick });
    socket.join(roomCode);

    console.log(`[~] ${nick} se reconectó a sala ${roomCode} (${oldSocketId} → ${socket.id})`);

    // Devolver fase actual + datos necesarios para que game.js arranque
    const response = {
      roomCode,
      playerId:    socket.id,
      nick,
      roomState:   room.state,
      fleetConfig: require('./src/GameRoom').FLEET_CONFIG,
      boardSize:   require('./src/GameRoom').BOARD_SIZE,
    };

    if (room.state === 'placement' || room.state === 'playing') {
      response.gameState = room.getStateForPlayer(socket.id);
    }

    callback?.(response);
  });

  // ── Solicitar estado actual (reconexión / refresh) ───────────────────────
  socket.on('game:requestState', (_, callback) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return callback?.({ error: 'No estás en ninguna sala.' });

    const room = rooms.get(meta.roomCode);
    if (!room) return callback?.({ error: 'Sala no encontrada.' });

    callback?.({ state: room.getStateForPlayer(socket.id) });
  });

  // ── Mensaje de chat ──────────────────────────────────────────────────────
  socket.on('chat:message', ({ text }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;

    const player = room.getPlayer(socket.id);
    const nick   = player?.nick || 'Desconocido';
    const safe   = (text || '').trim().substring(0, 200);
    if (!safe) return;

    broadcastEvent(meta.roomCode, `💬 ${nick}: ${safe}`);
  });

  // ── Desconexión ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;

    const { roomCode, nick } = meta;
    const room = rooms.get(roomCode);
    socketMeta.delete(socket.id);

    if (!room) return;

    room.removePlayer(socket.id);
    console.log(`[-] ${nick} desconectado de sala ${roomCode}`);

    if (room.players.size === 0) {
      // Limpiar sala vacía
      rooms.delete(roomCode);
      console.log(`[-] Sala ${roomCode} eliminada (sin jugadores)`);
      return;
    }

    // Si el host se fue, promover al siguiente jugador
    if (room.hostId === socket.id) {
      room.hostId = room.players.keys().next().value;
    }

    broadcastEvent(roomCode, `${nick} se ha desconectado.`);
    broadcastLobby(roomCode);

    // Si la partida estaba en curso y queda un solo jugador vivo, terminar
    if (room.state === 'playing') {
      const alivePlayers = [...room.players.values()].filter(p => p.alive);
      if (alivePlayers.length === 1) {
        room.state = 'finished';
        io.to(roomCode).emit('game:over', {
          winner: { playerId: alivePlayers[0].playerId, nick: alivePlayers[0].nick },
        });
      } else {
        broadcastGameState(roomCode);
      }
    }
  });
});

// ─── Limpiar salas antiguas cada hora ──────────────────────────────────────
setInterval(() => {
  const now     = Date.now();
  const maxAge  = 3 * 60 * 60 * 1000; // 3 horas
  for (const [code, room] of rooms) {
    if (now - room.createdAt > maxAge) {
      rooms.delete(code);
      console.log(`[~] Sala ${code} expirada y eliminada.`);
    }
  }
}, 60 * 60 * 1000);

// ─── Iniciar servidor ──────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚢 Batalla Rivera Garcia Multijugador corriendo en http://localhost:${PORT}\n`);
});
