import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type FontMode = 'clean' | 'serif' | 'hacker';

interface ThemeContextType {
  isDark: boolean;
  toggle: () => void;
  font: FontMode;
  cycleFont: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  isDark: false,
  toggle: () => {},
  font: 'clean',
  cycleFont: () => {},
});

const FONT_CYCLE: FontMode[] = ['clean', 'serif', 'hacker'];

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  const [font, setFont] = useState<FontMode>(() => {
    return (localStorage.getItem('font') as FontMode) ?? 'clean';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    document.documentElement.classList.remove('font-clean', 'font-serif', 'font-hacker');
    document.documentElement.classList.add(`font-${font}`);
    localStorage.setItem('font', font);
  }, [font]);

  const cycleFont = () => {
    setFont((f) => {
      const idx = FONT_CYCLE.indexOf(f);
      return FONT_CYCLE[(idx + 1) % FONT_CYCLE.length];
    });
  };

  return (
    <ThemeContext.Provider value={{ isDark, toggle: () => setIsDark((d) => !d), font, cycleFont }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
