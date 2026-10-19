'use strict';

// ═══════════════════════════════════════════════════════
//  PALETA DE COLORES DE BARCOS — compartida entre
//  placement.js y game.js
// ═══════════════════════════════════════════════════════
window.ShipColors = (() => {
  // 10 colores distintos y visibles sobre fondo oscuro
  const PALETTE = [
    '#00d4ff',  // cian
    '#ffd700',  // dorado
    '#00e676',  // verde
    '#ff6b6b',  // rojo suave
    '#c792ea',  // lila
    '#ff9800',  // naranja
    '#80cbc4',  // turquesa
    '#f06292',  // rosa
    '#aed581',  // verde lima
    '#4fc3f7',  // azul cielo
  ];

  // Mapa shipId → color (persistente durante la sesión)
  const map = {};
  let idx   = 0;

  function getColor(shipId) {
    if (!map[shipId]) {
      map[shipId] = PALETTE[idx % PALETTE.length];
      idx++;
    }
    return map[shipId];
  }

  // Devuelve una versión más oscura/transparente para el fondo de la celda
  function getBgColor(shipId) {
    const hex = getColor(shipId);
    return hex + '33'; // ~20% opacidad
  }

  function reset() { Object.keys(map).forEach(k => delete map[k]); idx = 0; }

  return { getColor, getBgColor, reset };
})();

// ═══════════════════════════════════════════════════════
//  placement.js — Módulo de posicionamiento de barcos
//  Se carga antes de game.js y expone window.PlacementModule
// ═══════════════════════════════════════════════════════

window.PlacementModule = (() => {

  // ─── Estado del módulo ────────────────────────────────
  let BOARD_SIZE   = 10;
  let FLEET_CONFIG = [];
  let socket       = null;

  // Barcos pendientes de colocar: { id, size, placed:bool }
  let pendingShips = [];
  // Barcos ya colocados: { id, size, cells }
  let placedShips  = [];

  // Nave seleccionada actualmente
  let selectedShip = null;
  // Orientación: 'H' | 'V'
  let orientation  = 'H';
  // Celda sobre la que está el cursor
  let hoverCell    = null;

  // Callbacks
  let onReadyCb    = null;

  // ─── DOM ──────────────────────────────────────────────
  const boardEl       = document.getElementById('placement-board');
  const fleetListEl   = document.getElementById('fleet-list');
  const btnRotate     = document.getElementById('btn-rotate');
  const btnClear      = document.getElementById('btn-clear-ships');
  const btnReady      = document.getElementById('btn-ready');
  const statusEl      = document.getElementById('placement-status');
  const rotationLabel = document.getElementById('rotation-label');

  // ─── Inicialización ───────────────────────────────────
  function init(socketInstance, fleetConfig, boardSize, readyCallback) {
    socket      = socketInstance;
    FLEET_CONFIG = fleetConfig;
    BOARD_SIZE   = boardSize;
    onReadyCb    = readyCallback;

    // Construir lista de barcos pendientes con IDs únicos
    pendingShips = [];
    let shipIndex = 0;
    for (const { size, count } of FLEET_CONFIG) {
      for (let i = 0; i < count; i++) {
        pendingShips.push({ id: `ship_${shipIndex++}`, size, placed: false });
      }
    }

    buildBoard();
    buildFleetList();
    bindControls();

    document.getElementById('phase-placement').classList.remove('hidden');
  }

  // ─── Construir tablero visual ─────────────────────────
  function buildBoard() {
    boardEl.innerHTML = '';

    // Celda esquina vacía
    const corner = document.createElement('div');
    corner.className = 'board__corner';
    boardEl.appendChild(corner);

    // Etiquetas de columna (A-J)
    for (let c = 0; c < BOARD_SIZE; c++) {
      const lbl = document.createElement('div');
      lbl.className = 'board__col-label';
      lbl.textContent = String.fromCharCode(65 + c);
      boardEl.appendChild(lbl);
    }

    // Filas
    for (let r = 0; r < BOARD_SIZE; r++) {
      // Etiqueta de fila
      const rowLbl = document.createElement('div');
      rowLbl.className = 'board__row-label';
      rowLbl.textContent = r + 1;
      boardEl.appendChild(rowLbl);

      // Celdas
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = document.createElement('div');
        cell.className  = 'board__cell';
        cell.dataset.row = r;
        cell.dataset.col = c;

        cell.addEventListener('mouseenter', () => onCellHover(r, c));
        cell.addEventListener('mouseleave', onCellLeave);
        cell.addEventListener('click',      () => onCellClick(r, c));

        boardEl.appendChild(cell);
      }
    }
  }

  // ─── Construir lista de flota ─────────────────────────
  function buildFleetList() {
    fleetListEl.innerHTML = '';

    // Agrupar por tamaño para mostrar como grupos
    for (const { size, count } of [...FLEET_CONFIG].reverse()) {
      const shipsOfSize = pendingShips.filter(s => s.size === size);

      const item = document.createElement('div');
      item.className = 'fleet-ship-item';
      item.dataset.size = size;
      // Tomamos el primer barco disponible al hacer clic
      item.addEventListener('click', () => selectShipOfSize(size));

      const cells = Array.from({ length: size }, () =>
        `<div class="fleet-ship-cell"></div>`
      ).join('');

      const placedCount = shipsOfSize.filter(s => s.placed).length;

      item.innerHTML = `
        <div class="fleet-ship-cells">${cells}</div>
        <span class="fleet-ship-label">${getSizeName(size)}</span>
        <span class="fleet-ship-count" data-size="${size}">${placedCount}/${count}</span>
      `;

      if (placedCount === count) item.classList.add('placed');

      fleetListEl.appendChild(item);
    }
  }

  function getSizeName(size) {
    return { 4: 'Acorazado (4)', 3: 'Crucero (3)', 2: 'Destructor (2)', 1: 'Submarino (1)' }[size] || `Nave (${size})`;
  }

  function updateFleetList() {
    for (const { size, count } of FLEET_CONFIG) {
      const counter  = fleetListEl.querySelector(`.fleet-ship-count[data-size="${size}"]`);
      const item     = fleetListEl.querySelector(`.fleet-ship-item[data-size="${size}"]`);
      if (!counter || !item) continue;
      const placed = pendingShips.filter(s => s.size === size && s.placed).length;
      counter.textContent = `${placed}/${count}`;
      item.classList.toggle('placed', placed === count);
      item.classList.toggle('selected', selectedShip?.size === size && !item.classList.contains('placed'));
    }

    // Actualizar botón Listo
    const allPlaced = pendingShips.every(s => s.placed);
    btnReady.disabled = !allPlaced;
    statusEl.textContent = allPlaced
      ? '✅ Flota completa. ¡Ya puedes confirmar!'
      : `Faltan ${pendingShips.filter(s => !s.placed).length} nave(s) por colocar.`;
  }

  // ─── Selección de nave ────────────────────────────────
  function selectShipOfSize(size) {
    // Buscar la primera no colocada de ese tamaño
    const ship = pendingShips.find(s => s.size === size && !s.placed);
    if (!ship) return;

    selectedShip = ship;
    updateFleetList();
    setStatus(`Nave de ${size} casilla(s) seleccionada. Haz clic en el tablero para colocarla.`);
  }

  // ─── Hover: previsualizar colocación ─────────────────
  function onCellHover(row, col) {
    if (!selectedShip) {
      // Highlight si hay un barco en esa celda para poder quitarlo
      const ship = getShipAtCell(row, col);
      if (ship) highlightShip(ship.id, 'hover');
      return;
    }
    hoverCell = { row, col };
    renderPreview(row, col);
  }

  function onCellLeave() {
    if (!selectedShip) {
      clearHighlights();
      return;
    }
    hoverCell = null;
    clearPreview();
  }

  function renderPreview(row, col) {
    clearPreview();
    const cells = getShipCells(row, col, selectedShip.size, orientation);
    const valid  = isValidPlacement(cells);

    for (const { row: r, col: c } of cells) {
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue;
      const cell = getCellEl(r, c);
      if (cell) {
        cell.classList.add(valid ? 'board__cell--preview' : 'board__cell--preview-invalid');
      }
    }
  }

  function clearPreview() {
    boardEl.querySelectorAll('.board__cell--preview, .board__cell--preview-invalid')
      .forEach(c => {
        c.classList.remove('board__cell--preview', 'board__cell--preview-invalid');
      });
  }

  // ─── Clic: colocar o quitar nave ──────────────────────
  function onCellClick(row, col) {
    // Si hay nave en esa celda → quitarla
    const existingShip = getShipAtCell(row, col);
    if (existingShip) {
      removeShipFromBoard(existingShip.id);
      return;
    }

    if (!selectedShip) return;

    const cells = getShipCells(row, col, selectedShip.size, orientation);
    if (!isValidPlacement(cells)) {
      setStatus('❌ Posición inválida. Prueba otro lugar.', true);
      return;
    }

    placeShipOnBoard(selectedShip.id, selectedShip.size, cells);
  }
  function placeShipOnBoard(shipId, size, cells) {
    socket.emit('ship:place', { shipId, size, cells }, (res) => {
      if (res?.error) {
        setStatus(`❌ ${res.error}`, true);
        return;
      }

      // Marcar como colocado
      const ship = pendingShips.find(s => s.id === shipId);
      if (ship) ship.placed = true;

      if (window.SoundFX) SoundFX.placeShip();

      placedShips.push({ id: shipId, size, cells });

      // Pintar en el tablero con el color del barco
      const shipColor  = window.ShipColors ? ShipColors.getColor(shipId) : null;
      const shipBg     = window.ShipColors ? ShipColors.getBgColor(shipId) : null;
      for (const { row, col } of cells) {
        const cell = getCellEl(row, col);
        if (cell) {
          cell.classList.add('board__cell--ship');
          cell.dataset.shipId = shipId;
          if (shipColor) {
            cell.style.borderColor = shipColor;
            cell.style.background  = `linear-gradient(135deg, ${shipBg}, rgba(0,40,80,0.7))`;
            cell.style.boxShadow   = `inset 0 0 4px ${shipColor}66`;
          }
        }
      }

      clearPreview();
      selectedShip = null;

      // Seleccionar la siguiente nave disponible automáticamente
      const next = pendingShips.find(s => !s.placed);
      if (next) selectShipOfSize(next.size);

      updateFleetList();
    });
  }

  // ─── Quitar nave ──────────────────────────────────────
  function removeShipFromBoard(shipId) {
    socket.emit('ship:remove', { shipId }, (res) => {
      if (res?.error) {
        setStatus(`❌ ${res.error}`, true);
        return;
      }

      // Limpiar tablero visual
      boardEl.querySelectorAll(`[data-ship-id="${shipId}"]`).forEach(cell => {
        cell.classList.remove('board__cell--ship');
        cell.style.borderColor = '';
        cell.style.background  = '';
        cell.style.boxShadow   = '';
        delete cell.dataset.shipId;
      });

      // Actualizar estado local
      const ship = pendingShips.find(s => s.id === shipId);
      if (ship) ship.placed = false;
      placedShips = placedShips.filter(s => s.id !== shipId);

      if (window.SoundFX) SoundFX.removeShip();

      updateFleetList();
      setStatus('Nave retirada. Puedes reposicionarla.');
    });
  }

  // ─── Limpiar todo ─────────────────────────────────────
  function clearAllShips() {
    // Quitar todas de una vez
    const toRemove = [...placedShips];
    if (toRemove.length === 0) return;

    let pending = toRemove.length;
    for (const ship of toRemove) {
      socket.emit('ship:remove', { shipId: ship.id }, () => {
        pending--;
        if (pending === 0) {
          // Limpiar toda la UI
          boardEl.querySelectorAll('.board__cell--ship').forEach(c => {
            c.classList.remove('board__cell--ship');
            c.style.borderColor = '';
            c.style.background  = '';
            c.style.boxShadow   = '';
            delete c.dataset.shipId;
          });
          if (window.ShipColors) ShipColors.reset();
          pendingShips.forEach(s => { s.placed = false; });
          placedShips = [];
          updateFleetList();
          setStatus('Tablero limpiado. Empieza de nuevo.');
        }
      });
    }
  }

  // ─── Helpers ──────────────────────────────────────────
  function getShipCells(row, col, size, orient) {
    const cells = [];
    for (let i = 0; i < size; i++) {
      cells.push(orient === 'H' ? { row, col: col + i } : { row: row + i, col });
    }
    return cells;
  }

  function isValidPlacement(cells) {
    for (const { row, col } of cells) {
      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return false;
      const cell = getCellEl(row, col);
      if (cell && cell.classList.contains('board__cell--ship')) return false;
    }
    return true;
  }

  function getCellEl(row, col) {
    return boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  }

  function getShipAtCell(row, col) {
    const cell = getCellEl(row, col);
    if (!cell || !cell.dataset.shipId) return null;
    return placedShips.find(s => s.id === cell.dataset.shipId) || null;
  }

  function highlightShip(shipId) {
    boardEl.querySelectorAll(`[data-ship-id="${shipId}"]`).forEach(c => {
      c.style.filter = 'brightness(1.5)';
    });
  }

  function clearHighlights() {
    boardEl.querySelectorAll('[data-ship-id]').forEach(c => {
      c.style.filter = '';
    });
  }

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? 'var(--color-danger)' : '';
  }

  // ─── Controles: rotar y limpiar ───────────────────────
  function bindControls() {
    btnRotate.addEventListener('click', () => {
      orientation = orientation === 'H' ? 'V' : 'H';
      rotationLabel.textContent = orientation === 'H' ? 'Horizontal' : 'Vertical';
      if (window.SoundFX) SoundFX.rotateShip();
      if (hoverCell) renderPreview(hoverCell.row, hoverCell.col);
    });

    // Atajo de teclado: R para rotar
    document.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') {
        btnRotate.click();
      }
    });

    btnClear.addEventListener('click', clearAllShips);

    btnReady.addEventListener('click', () => {
      btnReady.disabled = true;
      btnReady.textContent = 'Confirmando…';
      if (window.SoundFX) SoundFX.playerReady();
      socket.emit('player:ready', {}, (res) => {
        if (res?.error) {
          setStatus(`❌ ${res.error}`, true);
          btnReady.disabled = false;
          btnReady.textContent = '✅ ¡Listo para combatir!';
          return;
        }
        btnReady.textContent = '⏳ Esperando al resto de jugadores…';
        setStatus('Esperando que los demás jugadores estén listos…');
        if (onReadyCb) onReadyCb();
      });
    });
  }

  // ─── Actualizar tablero desde respuesta del servidor ──
  function applyServerState(ownerView) {
    // Sincronizar si hay desfase (reconexión)
    if (!ownerView) return;
    // No reconstruir completo para evitar parpadeo, solo marcar las celdas
  }

  // ─── API pública ──────────────────────────────────────
  return { init, applyServerState };

})();
