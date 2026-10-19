// The first-open tutorial a panel manifest declares: a few short pages the
// shell clicks through the first time someone opens the panel. One
// implementation of the rule: the daemon's manifest validator and the packer
// both call it, so a manifest that packs is a manifest the daemon lists.
//
//   "tutorial": [{
//     "image": { "light": "./tutorial/1-light.webp", "dark": "./tutorial/1-dark.webp", "alt": "Three open tabs" },
//     "title": "Tabs stay open", "body": "..."
//   }]
//
// Image paths are relative to the panel's build: the files live in dist/
// (a Vite panel puts them in public/), because dist/ is what the install
// archive carries and what the panel's origin serves first. A step without
// an image may name a Material Symbols icon instead.

export const MAX_TUTORIAL_STEPS = 6;
export const MAX_TUTORIAL_TITLE_LENGTH = 80;
export const MAX_TUTORIAL_BODY_LENGTH = 400;
export const MAX_TUTORIAL_ALT_LENGTH = 120;
export const TUTORIAL_IMAGE_EXTENSIONS = ["png", "webp", "jpg", "jpeg"];

// a Material Symbols ligature name, the same vocabulary PaperIcon renders
const ICON_PATTERN = /^[a-z0-9_]{1,48}$/;

// relative, inside the build, an image extension; no `..` segment
const IMAGE_PATH_PATTERN = new RegExp(`^(\\./)?[A-Za-z0-9_-][A-Za-z0-9._/-]{0,250}\\.(${TUTORIAL_IMAGE_EXTENSIONS.join("|")})$`);

export interface TutorialImage {
    /** shown in light mode, and in dark mode when there is no `dark` */
    light: string;
    dark?: string;
    /** what the picture shows, for anyone who can't see it */
    alt: string;
}

export interface TutorialStep {
    title: string;
    body: string;
    /** a picture of the panel shown beside the text */
    image?: TutorialImage;
    /** a Material Symbols name shown above the title, for a step without an image */
    icon?: string;
}

export function isTutorialImagePath(value: unknown): value is string {
    return typeof value === "string" && IMAGE_PATH_PATTERN.test(value) && !value.split("/").includes("..");
}

function validateImage(raw: unknown, index: number): TutorialImage {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`tutorial step ${index} image must be an object`);
    }
    const record = raw as Record<string, unknown>;
    if (!isTutorialImagePath(record.light) || (record.dark !== undefined && !isTutorialImagePath(record.dark))) {
        throw new Error(`tutorial step ${index} image paths must be relative ${TUTORIAL_IMAGE_EXTENSIONS.join("/")} files inside the build`);
    }
    if (typeof record.alt !== "string" || !record.alt.trim() || record.alt.length > MAX_TUTORIAL_ALT_LENGTH) {
        throw new Error(`tutorial step ${index} image needs alt text of at most ${MAX_TUTORIAL_ALT_LENGTH} characters`);
    }
    const image: TutorialImage = { light: record.light, alt: record.alt.trim() };
    if (record.dark !== undefined) image.dark = record.dark as string;
    return image;
}

/** The image files a tutorial names, each once, in order. */
export function tutorialImagePaths(steps: TutorialStep[]): string[] {
    const paths = steps.flatMap((step) => (step.image ? [step.image.light, step.image.dark ?? step.image.light] : []));
    return [...new Set(paths)];
}

/**
 * Returns the steps a panel manifest declares, or throws naming the first one
 * that breaks the rules. A missing field means no tutorial.
 */
export function validateTutorialDeclaration(raw: unknown): TutorialStep[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error("manifest tutorial must be an array");
    if (raw.length === 0 || raw.length > MAX_TUTORIAL_STEPS) {
        throw new Error(`a tutorial has 1 to ${MAX_TUTORIAL_STEPS} steps`);
    }
    return raw.map((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`tutorial step ${index} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if (typeof record.title !== "string" || !record.title.trim() || record.title.length > MAX_TUTORIAL_TITLE_LENGTH) {
            throw new Error(`tutorial step ${index} needs a title of at most ${MAX_TUTORIAL_TITLE_LENGTH} characters`);
        }
        if (typeof record.body !== "string" || !record.body.trim() || record.body.length > MAX_TUTORIAL_BODY_LENGTH) {
            throw new Error(`tutorial step ${index} needs a body of at most ${MAX_TUTORIAL_BODY_LENGTH} characters`);
        }
        const step: TutorialStep = { title: record.title.trim(), body: record.body.trim() };
        if (record.image !== undefined) step.image = validateImage(record.image, index);
        if (record.icon !== undefined) {
            if (typeof record.icon !== "string" || !ICON_PATTERN.test(record.icon)) {
                throw new Error(`tutorial step ${index} icon must be a Material Symbols name`);
            }
            step.icon = record.icon;
        }
        return step;
    });
}
