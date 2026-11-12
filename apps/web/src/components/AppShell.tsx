import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Top bar + footer around the simulator and artwork pages. The GiftBox page renders without it. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-container">
      <header className="app-topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand-logo">
            <span className="logo-symbol">&equiv;</span>
            <span className="logo-text">NFC Art Journal</span>
          </Link>
          <nav className="topbar-nav">
            <Link to="/" className="nav-item">Simulator</Link>
            <Link to="/t/tag_art_01" className="nav-item">Demo Tag</Link>
            <Link to="/t/tag_gift_01" className="nav-item">Demo Gift</Link>
          </nav>
        </div>
      </header>

      <main className="main-content">{children}</main>

      <footer className="app-footer">
        <p>NFC Art Journal &bull; Phase 1 Tap Routing Lifecycle</p>
      </footer>
    </div>
  );
}
