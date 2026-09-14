// Single source for native window chrome colors — titlebar overlay and
// window background must agree, and both variants (dark/light) live here.
// Kept in papercrane so the Electron host and any future host reuse them.
//
// These MIRROR PaperUI tokens the native layer cannot read as CSS vars:
//   TITLEBAR_OVERLAY  -> --paper-background-back
//   WINDOW_BACKGROUND -> --paper-background-frontest (light) / --paper-background-backest (dark)
// tests/themeConstants.test.ts parses colors.css and fails if they drift.
export const TITLEBAR_OVERLAY_COLORS = {
    dark: "#1a1b1e",
    light: "#e2e6eb",
} as const;

export const TITLEBAR_SYMBOL_COLORS = {
    dark: "#f5f5f5",
    light: "#0f1319",
} as const;

export const WINDOW_BACKGROUND_COLORS = {
    dark: "#141517",
    light: "#ffffff",
} as const;