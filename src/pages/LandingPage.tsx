import { useNavigate } from 'react-router-dom';
import { Bitcoin, ChevronRight, Moon, Sun } from 'lucide-react';
import { useTheme, FontMode } from '../contexts/ThemeContext';

const FONT_LABELS: Record<FontMode, string> = {
  clean: 'Aa',
  serif: 'Ff',
  hacker: '</>',
};

export default function LandingPage() {
  const navigate = useNavigate();
  const { isDark, toggle, font, cycleFont } = useTheme();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black flex flex-col">
      {/* Top-right controls */}
      <div className="flex justify-end gap-1 p-4">
        <button
          onClick={cycleFont}
          className="px-2 py-1 rounded text-xs font-medium text-gray-400 dark:text-zinc-600 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-950 transition-colors"
          title={`Font: ${font}`}
        >
          {FONT_LABELS[font]}
        </button>
        <button
          onClick={toggle}
          className="p-1.5 rounded text-gray-400 dark:text-zinc-600 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-950 transition-colors"
          aria-label="Toggle dark mode"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      {/* Centered content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-12">
          <Bitcoin className="w-8 h-8 text-gray-900 dark:text-white" />
          <span className="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
            Systemmatic BTC
          </span>
        </div>

        {/* Prompt */}
        <p className="text-sm text-gray-400 dark:text-zinc-600 mb-6 tracking-wide uppercase">
          Select asset
        </p>

        {/* Asset options */}
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-4 px-5 py-4 border border-gray-200 dark:border-zinc-900 rounded-lg hover:border-gray-400 dark:hover:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-950 transition-all text-left group"
          >
            <div className="p-2 rounded-lg bg-gray-100 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-900 group-hover:border-gray-300 dark:group-hover:border-zinc-700 transition-colors">
              <Bitcoin className="w-5 h-5 text-gray-700 dark:text-white" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900 dark:text-white">Bitcoin</p>
              <p className="text-xs text-gray-400 dark:text-zinc-600 mt-0.5">BTC / USD</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 dark:text-zinc-800 group-hover:text-gray-500 dark:group-hover:text-zinc-500 transition-colors" />
          </button>
        </div>
      </div>

      {/* Subtle footer */}
      <div className="py-6 text-center">
        <p className="text-xs text-gray-300 dark:text-zinc-800">
          More assets coming soon
        </p>
      </div>
    </div>
  );
}
