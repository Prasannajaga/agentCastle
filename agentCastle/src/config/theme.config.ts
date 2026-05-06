export type Theme = "dark" | "light" | "system";

export interface ThemeConfig {
  defaultTheme: Theme;
  storageKey: string;
}

/**
 * Immutable configuration for the application's theme.
 * All theme-related default configurations must reside here to satisfy strict MVC rules.
 */
export const THEME_CONFIG: Readonly<ThemeConfig> = Object.freeze({
  defaultTheme: "system",
  storageKey: "vite-ui-theme",
});
