import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { socket } from "../lib/socket";
import { formatTime, getExpectedPosition } from "../lib/time";

function ControllerPage() {
  const [session, setSession] = useState(null);
  const [displays, setDisplays] = useState({});
  const [connected, setConnected] = useState(socket.connected);
  const [seekPosition, setSeekPosition] = useState("0");
  const [liveExpected, setLiveExpected] = useState(0);
  const [error, setError] = useState("");

  const sessionRef = useRef(null);
  const receivedAtRef = useRef(Date.now());
  const seekEditingRef = useRef(false);

  useEffect(() => {
    function handleSessionState(nextSession) {
      sessionRef.current = nextSession;
      receivedAtRef.current = Date.now();
      setSession(nextSession);
      setDisplays(nextSession.displays || {});
      setLiveExpected(nextSession.expectedPosition);

      if (!seekEditingRef.current) {
        setSeekPosition(String(Math.floor(nextSession.expectedPosition)));
      }
    }

    function handleDisplaysUpdate(nextDisplays) {
      setDisplays(nextDisplays || {});
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
    socket.on("displays:update", handleDisplaysUpdate);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    if (socket.connected) {
      socket.emit("controller:register");
      socket.emit("session:request");
    }

    return () => {
      socket.off("session:state", handleSessionState);
      socket.off("displays:update", handleDisplaysUpdate);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);

  // Tick expected position locally while playing so the UI advances between pushes.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!sessionRef.current) {
        return;
      }

      setLiveExpected(
        getExpectedPosition(sessionRef.current, receivedAtRef.current)
      );
    }, 250);

    return () => window.clearInterval(interval);
  }, []);

  function sendCommand(command) {
    setError("");

    socket.emit("controller:command", command, (result) => {
      if (!result?.ok) {
        setError(result?.error || "Unable to send command");
      }
    });
  }

  const displayList = Object.values(displays);

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Authoritative playback control</p>
          <h1>Controller</h1>
          <p className="lede">
            <Link to="/">Home</Link>
            {" · "}
            Open displays in other tabs to sync them here.
          </p>
        </div>

        <span className={`connection ${connected ? "connected" : "disconnected"}`}>
          {connected ? "Server connected" : "Server disconnected"}
        </span>
      </header>

      {error && <p className="error-message">{error}</p>}

      {!session ? (
        <p>Loading session state…</p>
      ) : (
        <>
          <section className="panel">
            <h2>Session</h2>

            <label className="field">
              <span>Video</span>
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
                Expected: <strong>{formatTime(liveExpected)}</strong>
              </span>
              <span>
                Version: <strong>{session.version}</strong>
              </span>
            </div>

            <div className="button-row">
              <button type="button" onClick={() => sendCommand({ type: "play" })}>
                Play / Resume
              </button>
              <button type="button" onClick={() => sendCommand({ type: "pause" })}>
                Pause
              </button>
              <button type="button" onClick={() => sendCommand({ type: "restart" })}>
                Restart
              </button>
            </div>

            <div className="seek-row">
              <label className="field">
                <span>Seek position (seconds)</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={seekPosition}
                  onFocus={() => {
                    seekEditingRef.current = true;
                  }}
                  onBlur={() => {
                    seekEditingRef.current = false;
                  }}
                  onChange={(event) => setSeekPosition(event.target.value)}
                />
              </label>

              <button
                type="button"
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
              <h2>Connected displays</h2>
              <p>
                {displayList.length} active display
                {displayList.length === 1 ? "" : "s"}
              </p>
            </div>

            {displayList.length === 0 ? (
              <p>
                No displays connected yet.{" "}
                <Link to="/">Open a new display</Link> from the home page.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Display</th>
                      <th>Connection</th>
                      <th>Playback</th>
                      <th>Position</th>
                      <th>Drift</th>
                      <th>Last update</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayList.map((display) => (
                      <tr key={display.displayId}>
                        <td>
                          <Link to={`/display/${display.displayId}`}>
                            {display.displayId}
                          </Link>
                        </td>
                        <td>{display.connectionStatus}</td>
                        <td>{display.playbackState}</td>
                        <td>{formatTime(display.reportedPosition)}</td>
                        <td className={Math.abs(display.driftMs) > 250 ? "drift-warn" : ""}>
                          {display.driftMs} ms
                        </td>
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
