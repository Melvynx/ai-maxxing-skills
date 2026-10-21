import * as React from "react";

import { applyTheme, saveTheme, systemTheme, type Theme } from "@/lib/theme";

type ThemeState = { theme: Theme; toggle: () => void };

const ThemeContext = React.createContext<ThemeState>({ theme: "light", toggle: () => {} });

/** `saved` comes from the cookie (read on the server too); without one the OS preference applies once hydrated. */
export function ThemeProvider({ saved, children }: { saved: Theme | null; children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>(saved ?? "light");
  React.useEffect(() => {
    const initial = saved ?? systemTheme();
    setTheme(initial);
    applyTheme(initial);
  }, [saved]);
  const toggle = React.useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      saveTheme(next);
      applyTheme(next);
      return next;
    });
  }, []);
  const value = React.useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => React.useContext(ThemeContext);
