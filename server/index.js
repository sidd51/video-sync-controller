import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";

const PORT = 3001;

const app = express();
app.use(cors());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const videos = [
  {
    id: "big-buck-bunny",
    title: "Big Buck Bunny",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
  },
  {
    id: "elephants-dream",
    title: "Elephants Dream",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"
  }
];

const session = {
  selectedVideoId: videos[0].id,
  isPlaying: false,
  positionAtLastUpdate: 0,
  updatedAt: Date.now(),
  version: 0,
  displays: {}
};

function getExpectedPosition() {
  if (!session.isPlaying) {
    return session.positionAtLastUpdate;
  }

  const elapsedSeconds = (Date.now() - session.updatedAt) / 1000;
  return session.positionAtLastUpdate + elapsedSeconds;
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

    socket.data.role = "display";
    socket.data.displayId = displayId;

    session.displays[displayId] = {
      displayId,
      socketId: socket.id,
      connectionStatus: "connected",
      playbackState: "loading",
      reportedPosition: 0,
      driftMs: 0,
      lastSeenAt: Date.now()
    };

    broadcastSession();
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

    // Controller receives refreshed telemetry without changing playback version.
    broadcastSession();
  });

  socket.on("disconnect", () => {
    const displayId = socket.data.displayId;

    if (displayId && session.displays[displayId]) {
      delete session.displays[displayId];
      broadcastSession();
    }

    console.log(`Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Sync server listening at http://localhost:${PORT}`);
});