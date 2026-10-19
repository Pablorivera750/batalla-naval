# 🚢 Batalla Naval Multijugador

Juego web de Batalla Naval en tiempo real para 2-6 jugadores, construido con **Node.js + Express + Socket.io** en el backend y **HTML5/CSS3/JavaScript vanilla** en el frontend.

---

## Características

- Crear salas con código único de 6 caracteres
- Unirse a partidas con nick personalizado
- Sala de espera (lobby) con lista de jugadores en tiempo real
- Posicionamiento de flota con previsualización y rotación (horizontal/vertical)
- Tableros enemigos en tiempo real con barcos ocultos (anti-trampas en backend)
- Sistema de turnos: impacto = disparo extra, agua = turno siguiente
- Historial de eventos y chat en partida
- Diseño responsive para escritorio y móvil

## Flota por jugador

| Nave       | Casillas | Cantidad |
|------------|----------|----------|
| Acorazado  | 4        | 1        |
| Crucero    | 3        | 2        |
| Destructor | 2        | 3        |
| Submarino  | 1        | 4        |

---

## Requisitos previos

- [Node.js](https://nodejs.org/) v18 o superior
- npm (incluido con Node.js)

Verifica tu versión:
```bash
node -v
npm -v
```

---

## Ejecución en local

### 1. Instalar dependencias

```bash
cd "batalla naval"
npm install
```

### 2. Iniciar el servidor

```bash
npm start
```

El servidor arranca en **http://localhost:3000**

### 3. Modo desarrollo (recarga automática)

```bash
npm run dev
```

Requiere `nodemon`, que ya viene incluido en las devDependencies.

### 4. Probar multijugador en local

Abre **dos o más pestañas** del navegador en `http://localhost:3000`:
- Pestaña 1: crea una partida → anota el código de sala
- Pestaña 2+: únete con el mismo código

---

## Estructura del proyecto

```
batalla naval/
├── server.js                  # Servidor Express + Socket.io
├── package.json
├── src/
│   └── GameRoom.js            # Lógica del juego (anti-trampas, anti-trampas)
└── public/
    ├── index.html             # Lobby / pantalla de inicio
    ├── game.html              # Pantalla de juego
    ├── styles/
    │   ├── main.css           # Estilos generales y lobby
    │   └── game.css           # Estilos del tablero y fases de juego
    └── js/
        ├── lobby.js           # Lógica del lobby (crear/unirse/sala de espera)
        ├── placement.js       # Módulo de posicionamiento de barcos
        └── game.js            # Lógica de la batalla en tiempo real
```

---

## Despliegue gratuito en la web

### Opción A — Render (recomendado, más sencillo)

1. Crea una cuenta gratuita en [render.com](https://render.com)
2. Sube el proyecto a un repositorio GitHub (público o privado)
3. En Render → **New → Web Service**
4. Conecta tu repositorio
5. Configura:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
6. Haz clic en **Deploy** — Render te dará una URL pública como `https://batalla-naval.onrender.com`

> ⚠ El plan gratuito de Render "duerme" la instancia tras 15 min de inactividad. El primer acceso puede tardar ~30 s en despertar.

---

### Opción B — Railway

1. Crea una cuenta en [railway.app](https://railway.app)
2. **New Project → Deploy from GitHub repo**
3. Selecciona tu repositorio
4. Railway detecta Node.js automáticamente y usa `npm start`
5. En **Settings → Networking** genera un dominio público

---

### Opción C — Fly.io

1. Instala la CLI: `npm install -g flyctl`
2. Inicia sesión: `fly auth login`
3. Dentro de la carpeta del proyecto:

```bash
fly launch
fly deploy
```

Fly.io genera una URL pública tipo `https://batalla-naval.fly.dev`

---

### Variables de entorno

El servidor usa `process.env.PORT` automáticamente, por lo que **no necesitas configurar ninguna variable de entorno** adicional para el despliegue básico.

Si quisieras configurar el puerto manualmente:

| Variable | Descripción              | Default |
|----------|--------------------------|---------|
| `PORT`   | Puerto del servidor HTTP | `3000`  |

---

## Guía rápida de juego

1. **Crear partida** → comparte el código de 6 letras con tus amigos
2. **Sala de espera** → el host pulsa "Iniciar Partida" cuando todos estén listos
3. **Posicionar flota** → haz clic en el tablero para colocar cada nave; usa el botón "Rotar" o la tecla **R** para cambiar orientación; haz clic en una nave colocada para quitarla
4. **Confirmar** → cuando hayas colocado todas las naves, pulsa "¡Listo para combatir!"
5. **Combate** → en tu turno, haz clic en el tablero de cualquier enemigo para disparar; **impacto = disparo extra**, **agua = turno siguiente**
6. **Victoria** → el último jugador con naves en pie gana la batalla

---

## Tecnologías utilizadas

| Capa       | Tecnología                        |
|------------|-----------------------------------|
| Backend    | Node.js 18+, Express 4, Socket.io 4 |
| Frontend   | HTML5, CSS3, JavaScript (ES2020)  |
| Tipografías| Orbitron, Exo 2 (Google Fonts)    |
| Despliegue | Render / Railway / Fly.io         |

---

## Licencia

MIT — libre para uso personal y comercial.
