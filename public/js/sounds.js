'use strict';

// ═══════════════════════════════════════════════════════
//  sounds.js — Efectos de sonido con Web Audio API
//  No requiere archivos de audio externos.
// ═══════════════════════════════════════════════════════

window.SoundFX = (() => {
  let ctx = null;
  let enabled = true;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Reanudar si estaba suspendido (política de autoplay)
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ─── Utilidad: encadenar nodos y reproducir ──────────
  function play(buildFn) {
    if (!enabled) return;
    try {
      buildFn(getCtx());
    } catch (e) {
      // Silenciar errores de audio (ej. contexto cerrado)
    }
  }

  // ─── Nota simple ─────────────────────────────────────
  function tone(freq, type, duration, gainVal, startTime, ac) {
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type      = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(gainVal, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  // ─── Ruido blanco filtrado ────────────────────────────
  function noise(duration, gainVal, filterFreq, ac) {
    const bufSize = ac.sampleRate * duration;
    const buffer  = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data    = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

    const source = ac.createBufferSource();
    source.buffer = buffer;

    const filter = ac.createBiquadFilter();
    filter.type            = 'lowpass';
    filter.frequency.value = filterFreq;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(gainVal, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);
    source.start();
    source.stop(ac.currentTime + duration);
  }

  // ═══════════════════════════════════════════════════════
  //  SONIDOS DEL JUEGO
  // ═══════════════════════════════════════════════════════

  // Colocar barco en el tablero — clic mecánico
  function placeShip() {
    play((ac) => {
      const t = ac.currentTime;
      tone(420, 'square', 0.06, 0.18, t,        ac);
      tone(600, 'square', 0.04, 0.12, t + 0.05, ac);
    });
  }

  // Quitar barco del tablero
  function removeShip() {
    play((ac) => {
      const t = ac.currentTime;
      tone(600, 'square', 0.04, 0.12, t,        ac);
      tone(420, 'square', 0.06, 0.10, t + 0.04, ac);
    });
  }

  // Rotar barco
  function rotateShip() {
    play((ac) => {
      const t = ac.currentTime;
      tone(800, 'sine', 0.05, 0.10, t,        ac);
      tone(1000,'sine', 0.05, 0.08, t + 0.05, ac);
    });
  }

  // Confirmar "Listo" — acorde positivo
  function playerReady() {
    play((ac) => {
      const t = ac.currentTime;
      tone(523, 'sine', 0.15, 0.15, t,        ac); // C5
      tone(659, 'sine', 0.15, 0.15, t + 0.10, ac); // E5
      tone(784, 'sine', 0.20, 0.18, t + 0.20, ac); // G5
    });
  }

  // Inicio de batalla — fanfarria breve
  function battleStart() {
    play((ac) => {
      const t = ac.currentTime;
      tone(392, 'sawtooth', 0.12, 0.20, t,        ac); // G4
      tone(523, 'sawtooth', 0.12, 0.20, t + 0.12, ac); // C5
      tone(659, 'sawtooth', 0.14, 0.22, t + 0.24, ac); // E5
      tone(784, 'sawtooth', 0.16, 0.25, t + 0.36, ac); // G5
      tone(1046,'sawtooth', 0.10, 0.30, t + 0.52, ac); // C6
    });
  }

  // Disparo al agua — golpe sordo + burbuja
  function shotMiss() {
    play((ac) => {
      const t = ac.currentTime;
      // Impacto de agua
      noise(0.35, 0.25, 400, ac);
      // Burbuja descendente
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, t + 0.05);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.45);
      gain.gain.setValueAtTime(0.15, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.start(t + 0.05);
      osc.stop(t + 0.5);
    });
  }

  // Disparo impacto — explosión corta
  function shotHit() {
    play((ac) => {
      const t = ac.currentTime;
      noise(0.5, 0.5, 1200, ac);
      tone(120, 'sawtooth', 0.3, 0.35, t,        ac);
      tone(80,  'sawtooth', 0.4, 0.30, t + 0.05, ac);
    });
  }

  // Barco hundido — explosión grande + nota grave resonante
  function shipSunk() {
    play((ac) => {
      const t = ac.currentTime;
      // Explosión
      noise(0.8, 0.7, 800, ac);
      // Resonancia grave
      tone(60,  'sawtooth', 0.6, 0.40, t,        ac);
      tone(45,  'sawtooth', 0.8, 0.35, t + 0.05, ac);
      // Eco descendente
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, t + 0.1);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.9);
      gain.gain.setValueAtTime(0.3, t + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.start(t + 0.1);
      osc.stop(t + 1.0);
    });
  }

  // Cambio de turno — pitido de radio / sonar
  function turnChange() {
    play((ac) => {
      const t = ac.currentTime;
      tone(880, 'sine', 0.08, 0.12, t,        ac);
      tone(660, 'sine', 0.10, 0.12, t + 0.10, ac);
    });
  }

  // Tu turno — ping de sonar
  function myTurn() {
    play((ac) => {
      const t = ac.currentTime;
      tone(1200, 'sine', 0.05, 0.15, t,        ac);
      tone(900,  'sine', 0.08, 0.18, t + 0.07, ac);
      tone(1200, 'sine', 0.05, 0.12, t + 0.16, ac);
    });
  }

  // Victoria
  function victory() {
    play((ac) => {
      const t = ac.currentTime;
      const melody = [523, 659, 784, 1047, 784, 1047];
      const times  = [0, 0.15, 0.30, 0.45, 0.65, 0.80];
      melody.forEach((freq, i) => {
        tone(freq, 'sawtooth', 0.25, 0.22, t + times[i], ac);
      });
    });
  }

  // Derrota — nota descendente triste
  function defeat() {
    play((ac) => {
      const t = ac.currentTime;
      tone(392, 'sawtooth', 0.3, 0.20, t,        ac);
      tone(330, 'sawtooth', 0.3, 0.18, t + 0.25, ac);
      tone(262, 'sawtooth', 0.4, 0.20, t + 0.50, ac);
    });
  }

  // ─── Toggle mute ─────────────────────────────────────
  function setEnabled(val) { enabled = val; }
  function isEnabled()     { return enabled; }

  return {
    placeShip, removeShip, rotateShip, playerReady,
    battleStart, shotMiss, shotHit, shipSunk,
    turnChange, myTurn, victory, defeat,
    setEnabled, isEnabled,
  };
})();
