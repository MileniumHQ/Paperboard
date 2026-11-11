// Saved app settings over their defaults, the same in main and the shell.

/**
 * Reduce motion used to turn blur off too. Settings saved before the two were
 * split, with reduce motion on, keep their blur off.
 */
export function withAppSettingsDefaults<T extends { reducedMotion: boolean; disableBlur: boolean }>(defaults: T, stored: Partial<T>): T {
    return { ...defaults, ...stored, disableBlur: stored.disableBlur ?? stored.reducedMotion ?? defaults.disableBlur };
}
