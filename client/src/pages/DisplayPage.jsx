import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { socket } from "../lib/socket";
import { formatTime, getExpectedPosition } from "../lib/time";

// Drift correction strategy (client-side, display-local):
// - |drift| < SOFT_MS  → leave playbackRate at 1.0 (noise / normal jitter)
// - SOFT_MS..HARD_MS   → nudge rate (0.95 / 1.05) to close the gap smoothly
// - |drift| > HARD_MS  → hard-seek to expected position (with cooldown)
const SOFT_DRIFT_MS = 120;
const HARD_DRIFT_MS = 500;
const SEEK_COOLDOWN_MS = 2000;
const RATE_FAST = 1.05;
const RATE_SLOW = 0.95;

function DisplayPage() {
  const { displayId } = useParams();

  const videoRef = useRef(null);
  const sessionRef = useRef(null);
  const receivedAtRef = useRef(Date.now());
  const appliedVersionRef = useRef(null);
  const pendingSyncRef = useRef(null);
  const lastHardSeekAtRef = useRef(0);
  const correctionRef = useRef("none");

  const [session, setSession] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [localPosition, setLocalPosition] = useState(0);
  const [driftMs, setDriftMs] = useState(0);
  const [playbackState, setPlaybackState] = useState("loading");
  const [correction, setCorrection] = useState("none");
  const [videoError, setVideoError] = useState("");

  const selectedVideo = session?.videos.find(
    (video) => video.id === session.selectedVideoId
  );

  useEffect(() => {
    setVideoError("");
  }, [selectedVideo?.id]);

  function expectedNow() {
    return getExpectedPosition(sessionRef.current, receivedAtRef.current);
  }

  function applyAuthoritativeState(nextSession) {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (video.readyState < 1) {
      pendingSyncRef.current = nextSession;
      return;
    }

    const expectedPosition = expectedNow();

    if (Math.abs(video.currentTime - expectedPosition) > 0.25) {
      video.currentTime = expectedPosition;
      lastHardSeekAtRef.current = Date.now();
    }

    video.playbackRate = 1;

    if (nextSession.isPlaying) {
      video.play().catch(() => {
        // Muted + playsInline keeps autoplay reliable in modern browsers.
      });
    } else {
      video.pause();
    }
  }

  /**
   * Continuous correction while playing.
   * Rate nudging for mild drift; hard seek when drift is large.
   */
  function correctDrift(video, drift) {
    const absDrift = Math.abs(drift);
    const now = Date.now();

    if (absDrift <= SOFT_DRIFT_MS) {
      if (video.playbackRate !== 1) {
        video.playbackRate = 1;
      }
      correctionRef.current = "none";
      return "none";
    }

    if (absDrift > HARD_DRIFT_MS) {
      const cooledDown = now - lastHardSeekAtRef.current >= SEEK_COOLDOWN_MS;

      if (cooledDown) {
        video.currentTime = expectedNow();
        video.playbackRate = 1;
        lastHardSeekAtRef.current = now;
        correctionRef.current = "hard-seek";
        return "hard-seek";
      }
    }

    // Mild drift: temporarily speed up or slow down to converge.
    const nextRate = drift < 0 ? RATE_FAST : RATE_SLOW;

    if (video.playbackRate !== nextRate) {
      video.playbackRate = nextRate;
    }

    correctionRef.current = drift < 0 ? "rate-fast" : "rate-slow";
    return correctionRef.current;
  }

  useEffect(() => {
    if (!displayId) {
      return undefined;
    }

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

      if (hasNewCommand) {
        appliedVersionRef.current = nextSession.version;
        window.setTimeout(() => {
          applyAuthoritativeState(nextSession);
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
      const currentSession = sessionRef.current;

      if (!video || !currentSession) {
        return;
      }

      const position = video.currentTime || 0;
      const expectedPosition = expectedNow();
      const nextDriftMs = Math.round((position - expectedPosition) * 1000);

      let nextCorrection = "none";

      if (currentSession.isPlaying && !video.paused && video.readyState >= 2) {
        nextCorrection = correctDrift(video, nextDriftMs);
      } else if (video.playbackRate !== 1) {
        video.playbackRate = 1;
      }

      const nextPlaybackState =
        video.readyState < 2
          ? "loading"
          : video.paused
            ? "paused"
            : "playing";

      setLocalPosition(position);
      setDriftMs(nextDriftMs);
      setPlaybackState(nextPlaybackState);
      setCorrection(nextCorrection);

      socket.emit("display:status", {
        position,
        playbackState: nextPlaybackState
      });
    }, 1000);

    return () => window.clearInterval(telemetryInterval);
  }, []);

  function handleLoadedMetadata() {
    setVideoError("");
    const nextSession = pendingSyncRef.current || sessionRef.current;

    if (nextSession) {
      pendingSyncRef.current = null;
      applyAuthoritativeState(nextSession);
    }
  }

  function handleVideoError() {
    const src = selectedVideo?.url || "unknown";
    setVideoError(`Failed to load video (${src}). Check that the file is available.`);
    setPlaybackState("error");
  }

  return (
    <main className="page display-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Synchronized display</p>
          <h1>{displayId}</h1>
          <p className="lede">
            <Link to="/">Home</Link>
            {" · "}
            <Link to="/controller">Controller</Link>
          </p>
        </div>

        <span className={`connection ${connected ? "connected" : "disconnected"}`}>
          {connected ? "Server connected" : "Server disconnected"}
        </span>
      </header>

      <section className="video-panel">
        {selectedVideo ? (
          <>
            <video
              ref={videoRef}
              key={selectedVideo.id}
              src={selectedVideo.url}
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={handleLoadedMetadata}
              onError={handleVideoError}
            />
            {videoError && <p className="video-error">{videoError}</p>}
          </>
        ) : (
          <p className="video-placeholder">Waiting for video selection…</p>
        )}
      </section>

      <section className="diagnostics">
        <div>
          <span>Client ID</span>
          <strong>{displayId}</strong>
        </div>
        <div>
          <span>Connection</span>
          <strong>{connected ? "connected" : "disconnected"}</strong>
        </div>
        <div>
          <span>Local playback</span>
          <strong>{playbackState}</strong>
        </div>
        <div>
          <span>Session state</span>
          <strong>{session?.isPlaying ? "Playing" : "Paused"}</strong>
        </div>
        <div>
          <span>Local position</span>
          <strong>{formatTime(localPosition)}</strong>
        </div>
        <div>
          <span>Drift</span>
          <strong className={Math.abs(driftMs) > SOFT_DRIFT_MS ? "drift-warn" : ""}>
            {driftMs} ms
          </strong>
        </div>
        <div>
          <span>Correction</span>
          <strong>{correction}</strong>
        </div>
        <div>
          <span>Version</span>
          <strong>{session?.version ?? "—"}</strong>
        </div>
      </section>
    </main>
  );
}

export default DisplayPage;
