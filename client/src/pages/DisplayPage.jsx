import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { socket } from "../lib/socket";

function formatTime(seconds = 0) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function DisplayPage() {
  const { displayId } = useParams();

  const videoRef = useRef(null);
  const sessionRef = useRef(null);
  const receivedAtRef = useRef(Date.now());
  const appliedVersionRef = useRef(null);
  const pendingSyncRef = useRef(null);

  const [session, setSession] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [localPosition, setLocalPosition] = useState(0);
  const [driftMs, setDriftMs] = useState(0);

  const selectedVideo = session?.videos.find(
    (video) => video.id === session.selectedVideoId
  );

  function getExpectedPositionNow() {
    const currentSession = sessionRef.current;

    if (!currentSession) {
      return 0;
    }

    if (!currentSession.isPlaying) {
      return currentSession.expectedPosition;
    }

    const elapsedSinceMessage = (Date.now() - receivedAtRef.current) / 1000;

    return currentSession.expectedPosition + elapsedSinceMessage;
  }

  function applyPlaybackState(nextSession) {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    // Wait until the new video's metadata is available before seeking.
    if (video.readyState < 1) {
      pendingSyncRef.current = nextSession;
      return;
    }

    const expectedPosition = getExpectedPositionNow();

    // Commands should take effect immediately. Small differences are tolerated.
    if (Math.abs(video.currentTime - expectedPosition) > 0.25) {
      video.currentTime = expectedPosition;
    }

    if (nextSession.isPlaying) {
      video.play().catch(() => {
        // Browsers may block unmuted autoplay. The video is muted by default.
      });
    } else {
      video.pause();
    }
  }

  useEffect(() => {
    function registerDisplay() {
      socket.emit("display:register", { displayId });
      socket.emit("session:request");
    }

    function handleConnect() {
      setConnected(true);
      registerDisplay();
    }

    function handleDisconnect() {
      setConnected(false);
    }

    function handleSessionState(nextSession) {
      const hasNewCommand =
        appliedVersionRef.current === null ||
        appliedVersionRef.current !== nextSession.version;

      sessionRef.current = nextSession;
      receivedAtRef.current = Date.now();
      setSession(nextSession);

      // Ignore status-only broadcasts. Apply only new controller commands.
      if (hasNewCommand) {
        appliedVersionRef.current = nextSession.version;

        window.setTimeout(() => {
          applyPlaybackState(nextSession);
        }, 0);
      }
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("session:state", handleSessionState);

    if (socket.connected) {
      registerDisplay();
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("session:state", handleSessionState);
    };
  }, [displayId]);

  useEffect(() => {
    const telemetryInterval = window.setInterval(() => {
      const video = videoRef.current;

      if (!video || !sessionRef.current) {
        return;
      }

      const position = video.currentTime || 0;
      const expectedPosition = getExpectedPositionNow();
      const nextDriftMs = Math.round((position - expectedPosition) * 1000);

      setLocalPosition(position);
      setDriftMs(nextDriftMs);

      socket.emit("display:status", {
        position,
        playbackState: video.readyState < 2
          ? "loading"
          : video.paused
            ? "paused"
            : "playing"
      });
    }, 1000);

    return () => window.clearInterval(telemetryInterval);
  }, []);

  function handleLoadedMetadata() {
    const nextSession = pendingSyncRef.current || sessionRef.current;

    if (nextSession) {
      pendingSyncRef.current = null;
      applyPlaybackState(nextSession);
    }
  }

  return (
    <main className="display-page">
      <header className="display-header">
        <div>
          <p className="eyebrow">Synchronized display client</p>
          <h1>{displayId}</h1>
        </div>

        <span className={`connection ${connected ? "connected" : "disconnected"}`}>
          {connected ? "● Server connected" : "● Server disconnected"}
        </span>
      </header>

      <section className="video-panel">
        {selectedVideo ? (
          <video
            ref={videoRef}
            key={selectedVideo.id}
            src={selectedVideo.url}
            controls
            muted
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
          />
        ) : (
          <p>Waiting for video selection…</p>
        )}
      </section>

      <section className="diagnostics">
        <div>
          <span>Playback state</span>
          <strong>{session?.isPlaying ? "Playing" : "Paused"}</strong>
        </div>

        <div>
          <span>Local position</span>
          <strong>{formatTime(localPosition)}</strong>
        </div>

        <div>
          <span>Current drift</span>
          <strong>{driftMs} ms</strong>
        </div>

        <div>
          <span>Server version</span>
          <strong>{session?.version ?? "—"}</strong>
        </div>
      </section>
    </main>
  );
}

export default DisplayPage;