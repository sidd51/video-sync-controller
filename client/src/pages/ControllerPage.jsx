import { useEffect, useState } from "react";
import { socket } from "../lib/socket";

function formatTime(seconds = 0) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function ControllerPage() {
  const [session, setSession] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [seekPosition, setSeekPosition] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    function handleSessionState(nextSession) {
      setSession(nextSession);
      setSeekPosition(Math.floor(nextSession.expectedPosition));
    }

    function handleConnect() {
      setConnected(true);
      socket.emit("controller:register");
      socket.emit("session:request");
    }

    function handleDisconnect() {
      setConnected(false);
    }

    socket.on("session:state", handleSessionState);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    // Handles the case where the socket connected before this component mounted.
    if (socket.connected) {
      socket.emit("controller:register");
      socket.emit("session:request");
    }

    return () => {
      socket.off("session:state", handleSessionState);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);

  function sendCommand(command) {
    setError("");

    socket.emit("controller:command", command, (result) => {
      if (!result.ok) {
        setError(result.error || "Unable to send command");
      }
    });
  }

  const displays = Object.values(session?.displays || {});

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Authoritative playback control</p>
          <h1>Video Sync Controller</h1>
        </div>

        <span className={`connection ${connected ? "connected" : "disconnected"}`}>
          {connected ? "● Server connected" : "● Server disconnected"}
        </span>
      </header>

      {error && <p className="error-message">{error}</p>}

      {!session ? (
        <p>Loading session state…</p>
      ) : (
        <>
          <section className="panel">
            <h2>Session</h2>

            <label>
              Video
              <select
                value={session.selectedVideoId}
                onChange={(event) =>
                  sendCommand({
                    type: "select-video",
                    videoId: event.target.value
                  })
                }
              >
                {session.videos.map((video) => (
                  <option key={video.id} value={video.id}>
                    {video.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="playback-summary">
              <span>
                State: <strong>{session.isPlaying ? "Playing" : "Paused"}</strong>
              </span>
              <span>
                Expected position: <strong>{formatTime(session.expectedPosition)}</strong>
              </span>
              <span>
                Version: <strong>{session.version}</strong>
              </span>
            </div>

            <div className="button-row">
              <button onClick={() => sendCommand({ type: "play" })}>
                Play / Resume
              </button>

              <button onClick={() => sendCommand({ type: "pause" })}>
                Pause
              </button>

              <button onClick={() => sendCommand({ type: "restart" })}>
                Restart
              </button>
            </div>

            <div className="seek-row">
              <label>
                Seek position (seconds)
                <input
                  type="number"
                  min="0"
                  value={seekPosition}
                  onChange={(event) => setSeekPosition(event.target.value)}
                />
              </label>

              <button
                onClick={() =>
                  sendCommand({
                    type: "seek",
                    position: Number(seekPosition)
                  })
                }
              >
                Seek
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Connected displays</h2>
                <p>{displays.length} active display{displays.length === 1 ? "" : "s"}</p>
              </div>
            </div>

            {displays.length === 0 ? (
              <p>No display clients are currently connected.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Display</th>
                      <th>Connection</th>
                      <th>Playback state</th>
                      <th>Local position</th>
                      <th>Drift</th>
                      <th>Last update</th>
                    </tr>
                  </thead>

                  <tbody>
                    {displays.map((display) => (
                      <tr key={display.displayId}>
                        <td>{display.displayId}</td>
                        <td>{display.connectionStatus}</td>
                        <td>{display.playbackState}</td>
                        <td>{formatTime(display.reportedPosition)}</td>
                        <td>{display.driftMs} ms</td>
                        <td>
                          {new Date(display.lastSeenAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default ControllerPage;