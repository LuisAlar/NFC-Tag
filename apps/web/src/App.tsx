import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { AppShell } from './components/AppShell';
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
      <Routes>
        <Route path="/" element={<AppShell><SimConsole /></AppShell>} />
        {/* The dispatcher picks its own frame: app shell for artwork, full-bleed for a gift. */}
        <Route path="/t/:tag_id" element={<TagDispatcher />} />
        <Route path="*" element={<AppShell><NotFound /></AppShell>} />
      </Routes>
    </BrowserRouter>
  );
}
