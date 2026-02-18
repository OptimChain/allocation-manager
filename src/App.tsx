import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Bitcoin, LayoutDashboard, GitCompare, TrendingUp, FlaskConical, Moon, Sun } from 'lucide-react';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';

// Import page components
import DashboardPage from './pages/DashboardPage';
import ComparePage from './pages/ComparePage';
import TradePage from './pages/TradePage';
import StrategiesPage from './pages/StrategiesPage';

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link
      to={to}
      className={`text-sm font-medium transition-colors pb-0.5 ${
        isActive
          ? 'text-gray-900 dark:text-gray-100 border-b border-gray-900 dark:border-gray-100'
          : 'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
      }`}
    >
      {children}
    </Link>
  );
}

function AppContent() {
  const { isDark, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center group">
              <Bitcoin className="h-6 w-6 text-gray-900 dark:text-gray-100" />
              <h1 className="ml-3 text-xl font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Systemmatic BTC</h1>
            </Link>
            <nav className="flex items-center space-x-8">
              <NavLink to="/">
                <span className="flex items-center gap-2">
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </span>
              </NavLink>
              <NavLink to="/compare">
                <span className="flex items-center gap-2">
                  <GitCompare className="w-4 h-4" />
                  Compare
                </span>
              </NavLink>
              <NavLink to="/trade">
                <span className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Trade
                </span>
              </NavLink>
              <NavLink to="/strategies">
                <span className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4" />
                  Strategies
                </span>
              </NavLink>
              <button
                onClick={toggle}
                className="p-1.5 rounded text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Toggle dark mode"
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/trade" element={<TradePage />} />
          <Route path="/strategies" element={<StrategiesPage />} />
        </Routes>
      </main>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-xs text-gray-400 dark:text-gray-500">
            Data provided by{' '}
            <a
              href="https://twelvedata.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 dark:text-gray-400 hover:underline"
            >
              Twelve Data
            </a>
            {', '}
            <a
              href="https://polygon.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 dark:text-gray-400 hover:underline"
            >
              Polygon.io
            </a>
            {' & '}
            <a
              href="https://www.coindesk.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 dark:text-gray-400 hover:underline"
            >
              CoinDesk
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <Router>
        <AppContent />
      </Router>
    </ThemeProvider>
  );
}
