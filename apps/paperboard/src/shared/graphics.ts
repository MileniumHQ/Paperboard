// Whether Chromium draws Paperboard on a GPU. Without one (a VM such as a
// Chromebook's Linux, or a GPU Chromium refuses), it composites in software,
// on the CPU: a dialog scrolled at 6 frames a second there with its backdrop
// blur, and 48 without. So there, animations and blur are off whatever the
// settings say; the settings are kept for a computer that has one.

export interface Graphics {
    gpu: boolean;
}

/** `gpuCompositing` is Electron's app.getGPUFeatureStatus().gpu_compositing: "enabled" on a GPU, "disabled_software" without one. */
export function graphicsFrom(gpuCompositing: string): Graphics {
    return { gpu: gpuCompositing.startsWith("enabled") };
}

/** What the window shows: the settings, with animations and blur off where there's no GPU. */
export function effectiveLook(settings: { reducedMotion: boolean; disableBlur: boolean }, graphics: Graphics): { reducedMotion: boolean; disableBlur: boolean } {
    return { reducedMotion: settings.reducedMotion || !graphics.gpu, disableBlur: settings.disableBlur || !graphics.gpu };
}
