// Whether Chromium draws Paperboard on a GPU. Without one (a VM such as a
// Chromebook's Linux, or a GPU Chromium refuses), it composites in software,
// on the CPU: a dialog scrolled at 6 frames a second there with its backdrop
// blur, and 48 without. So there, animations and blur start off; a choice
// made in the settings is kept either way.

export interface Graphics {
    gpu: boolean;
}

/** The two settings as saved: absent until the user chooses. */
export interface LookSettings {
    disableAnimations?: boolean;
    disableBlur?: boolean;
}

/** `gpuCompositing` is Electron's app.getGPUFeatureStatus().gpu_compositing: "enabled" on a GPU, "disabled_software" without one. */
export function graphicsFrom(gpuCompositing: string): Graphics {
    return { gpu: gpuCompositing.startsWith("enabled") };
}

/** What the window shows: the user's choice, and where there's none, animations and blur off only without a GPU. */
export function effectiveLook(settings: LookSettings, graphics: Graphics): { disableAnimations: boolean; disableBlur: boolean } {
    return { disableAnimations: settings.disableAnimations ?? !graphics.gpu, disableBlur: settings.disableBlur ?? !graphics.gpu };
}
