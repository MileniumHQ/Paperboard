// Saved app settings over their defaults, the same in main and the shell.
import type { LookSettings } from "./graphics";

/**
 * Disable animations and Disable blur are saved only once chosen, so a
 * computer without a GPU can start with both on (graphics.ts). Before the two
 * were split they were one `reducedMotion`, saved whether chosen or not: on,
 * it was a choice, and both stay on; off, it was most likely never touched.
 */
export function withAppSettingsDefaults<T extends LookSettings>(defaults: T, stored: Partial<T> & { reducedMotion?: boolean }): T {
    const { reducedMotion, ...saved } = stored;
    const settings = { ...defaults, ...saved } as T;
    if (reducedMotion === true) {
        settings.disableAnimations ??= true;
        settings.disableBlur ??= true;
    }
    return settings;
}
