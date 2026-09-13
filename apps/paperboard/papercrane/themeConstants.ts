// Single source for native window chrome colors — titlebar overlay and
// window background must agree, and both variants (dark/light) live here.
// Kept in papercrane so the Electron host and any future host reuse them.
export const TITLEBAR_OVERLAY_COLORS = {
    dark: "#2a2a2a",
    light: "#e2e6eb",
} as const;

export const TITLEBAR_SYMBOL_COLORS = {
    dark: "#f5f5f5",
    light: "#0f1319",
} as const;

export const WINDOW_BACKGROUND_COLORS = {
    dark: "#121316",
    light: "#ffffff",
} as const;