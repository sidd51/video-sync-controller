import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const isProduction = process.env.NODE_ENV === "production";

const app = express();
app.use(cors({ origin: isProduction ? true : CLIENT_ORIGIN }));

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: isProduction ? true : CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

// Served from client/public/videos (Vite + production static). Avoids flaky CDN 403s.
const videos = [
  {
    id: "big-buck-bunny",
    title: "Big Buck Bunny (10s)",
    url: "/videos/big-buck-bunny.mp4"
  },
  {
    id: "flower",
    title: "Flower",
    url: "/videos/flower.mp4"
  },
  {
    id: "sintel",
    title: "Sintel Trailer",
    url: "/videos/sintel.mp4"
  }
];

/**
 * Authoritative session state.
 *
 * Expected position formula:
 *   paused  → positionAtLastUpdate
 *   playing → positionAtLastUpdate + (now - updatedAt) / 1000
 *
 * We store an anchor (position + wall-clock time) instead of a ticking clock
 * so every client can compute the same expected position independently.
 */
const session = {
  selectedVideoId: videos[0].id,
  isPlaying: false,
  positionAtLastUpdate: 0,
  updatedAt: Date.now(),
  version: 0,
  displays: {}
};

function getExpectedPosition(at = Date.now()) {
  if (!session.isPlaying) {
    return session.positionAtLastUpdate;
  }

  const elapsedSeconds = (at - session.updatedAt) / 1000;
  return Math.max(0, session.positionAtLastUpdate + elapsedSeconds);
}

function getPublicSession() {
  return {
    videos,
    selectedVideoId: session.selectedVideoId,
    isPlaying: session.isPlaying,
    expectedPosition: getExpectedPosition(),
    version: session.version,
    updatedAt: session.updatedAt,
    displays: session.displays
  };
}

function broadcastSession() {
  io.emit("session:state", getPublicSession());
}

function broadcastDisplays() {
  io.emit("displays:update", session.displays);
}

function updatePlaybackState(updates) {
  Object.assign(session, updates, {
    version: session.version + 1,
    updatedAt: Date.now()
  });

  broadcastSession();
}

function applyControllerCommand(command) {
  const expectedPosition = getExpectedPosition();

  switch (command.type) {
    case "select-video": {
      const videoExists = videos.some((video) => video.id === command.videoId);

      if (!videoExists) {
        throw new Error("Unknown video selected");
      }

      updatePlaybackState({
        selectedVideoId: command.videoId,
        isPlaying: false,
        positionAtLastUpdate: 0
      });
      break;
    }

    case "play":
      updatePlaybackState({
        isPlaying: true,
        positionAtLastUpdate: expectedPosition
      });
      break;

    case "pause":
      updatePlaybackState({
        isPlaying: false,
        positionAtLastUpdate: expectedPosition
      });
      break;

    case "seek":
      updatePlaybackState({
        positionAtLastUpdate: Math.max(0, Number(command.position) || 0)
      });
      break;

    case "restart":
      updatePlaybackState({
        positionAtLastUpdate: 0
      });
      break;

    default:
      throw new Error("Unsupported controller command");
  }
}

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    session: getPublicSession()
  });
});

if (isProduction) {
  const clientDist = path.join(__dirname, "../client/dist");
  app.use(express.static(clientDist));

  // SPA fallback for client-side routes (/controller, /display/:id).
  app.use((_request, response) => {
    response.sendFile(path.join(clientDist, "index.html"));
  });
}

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.emit("session:state", getPublicSession());

  socket.on("controller:register", () => {
    socket.data.role = "controller";
  });

  socket.on("display:register", ({ displayId }) => {
    if (!displayId || typeof displayId !== "string") {
      return;
    }

    const normalizedId = displayId.trim().slice(0, 64);

    if (!normalizedId) {
      return;
    }

    socket.data.role = "display";
    socket.data.displayId = normalizedId;

    session.displays[normalizedId] = {
      displayId: normalizedId,
      socketId: socket.id,
      connectionStatus: "connected",
      playbackState: "loading",
      reportedPosition: 0,
      driftMs: 0,
      lastSeenAt: Date.now()
    };

    broadcastSession();
  });

  socket.on("session:request", () => {
    socket.emit("session:state", getPublicSession());
  });

  socket.on("controller:command", (command, acknowledge) => {
    if (socket.data.role !== "controller") {
      acknowledge?.({ ok: false, error: "Only controllers can send commands" });
      return;
    }

    try {
      applyControllerCommand(command);
      acknowledge?.({ ok: true });
    } catch (error) {
      acknowledge?.({ ok: false, error: error.message });
    }
  });

  socket.on("display:status", (status) => {
    const displayId = socket.data.displayId;

    if (!displayId || !session.displays[displayId]) {
      return;
    }

    const reportedPosition = Number(status.position) || 0;
    const expectedPosition = getExpectedPosition();

    session.displays[displayId] = {
      ...session.displays[displayId],
      connectionStatus: "connected",
      playbackState: status.playbackState || "unknown",
      reportedPosition,
      driftMs: Math.round((reportedPosition - expectedPosition) * 1000),
      lastSeenAt: Date.now()
    };

    // Telemetry should not bump version or force displays to re-apply state.
    broadcastDisplays();
  });

  socket.on("disconnect", () => {
    const displayId = socket.data.displayId;

    if (displayId && session.displays[displayId]) {
      delete session.displays[displayId];
      broadcastDisplays();
      broadcastSession();
    }

    console.log(`Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Sync server listening at http://localhost:${PORT}`);
});
