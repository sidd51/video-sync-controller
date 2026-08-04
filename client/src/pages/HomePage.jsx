import { Link, useNavigate } from "react-router-dom";

function createDisplayId() {
  return `display-${Math.random().toString(36).slice(2, 8)}`;
}

function HomePage() {
  const navigate = useNavigate();

  return (
    <main className="page home-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">BrandContext assignment</p>
          <h1>Video Sync</h1>
          <p className="lede">
            One controller drives multiple display clients through a
            server-authoritative Socket.IO session.
          </p>
        </div>
      </header>

      <section className="panel home-actions">
        <Link className="action-card" to="/controller">
          <strong>Open Controller</strong>
          <span>Select video, play/pause/seek, watch display drift</span>
        </Link>

        <button
          className="action-card"
          type="button"
          onClick={() => navigate(`/display/${createDisplayId()}`)}
        >
          <strong>Open New Display</strong>
          <span>Opens a display client with a unique ID</span>
        </button>
      </section>

      <p className="hint">
        Tip: open the controller in one tab, then open two or more displays in
        other tabs to see synchronisation and drift correction.
      </p>
    </main>
  );
}

export default HomePage;
