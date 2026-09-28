import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { SimConsole } from './components/SimConsole';
import { TagDispatcher } from './components/TagDispatcher';
import './App.css';

function NotFound() {
  return (
    <div className="flow-card error-card">
      <h2>404 - Page Not Found</h2>
      <p>The requested route does not exist.</p>
      <Link to="/" className="action-button secondary">
        Return to Simulator
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
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
            </nav>
          </div>
        </header>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<SimConsole />} />
            <Route path="/t/:tag_id" element={<TagDispatcher />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>

        <footer className="app-footer">
          <p>NFC Art Journal &bull; Phase 1 Tap Routing Lifecycle</p>
        </footer>
      </div>
    </BrowserRouter>
  );
}
