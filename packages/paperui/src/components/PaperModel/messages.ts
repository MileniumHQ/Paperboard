// What the viewer says when it can't show a model: one place, so the
// component, its scene and the thumbnails say the same thing.

export const MODEL_MESSAGES = {
    unreachable: "Can't load the model",
    missing: "The model isn't there anymore",
    unreadable: "Can't read this 3D model",
    empty: "This 3D model has nothing to show",
    foreign: "This model keeps its data on another site, which isn't loaded",
    compression: "This model is compressed in a way this page can't decode",
    format: "Can't tell which kind of 3D file this is",
    viewer: "Can't load the 3D viewer",
    webgl: "3D isn't available in this browser",
    lost: "The 3D view stopped",
} as const;

/** A failure the viewer shows, with Retry when trying again could help. */
export interface ModelFailure {
    message: string;
    retry?: () => void;
}
