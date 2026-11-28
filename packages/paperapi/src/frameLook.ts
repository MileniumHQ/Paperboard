import { currentFrameSession } from "./frameSession";

// How a panel looks is the shell's fact, and a panel is a frame of it: mobile
// mode (PaperUI's paperMobile), the theme the person chose, and whether
// animations and blur are off. The shell stamps them on the document when
// serving it, tells it again when it challenges the document (`mobile` and
// `look` on "paperboard:initialize") and whenever they change
// (MOBILE_MODE_MESSAGE, FRAME_LOOK_MESSAGE); this writes them on the
// document root, where PaperUI reads them. Every host does the same, so a
// panel in a browser tab looks like one in the desktop window.

/** PaperUI's MOBILE_ATTRIBUTE */
const MOBILE_ATTRIBUTE = "data-paper-mobile";
/** the message a shell sends a panel frame when mobile mode turns on or off */
export const MOBILE_MODE_MESSAGE = "paperboard:mobile";
/** the message a shell sends a panel frame when its theme, motion or blur changes */
export const FRAME_LOOK_MESSAGE = "paperboard:look";

export interface FrameLook {
    /** "system" follows the operating system, as the shell does */
    theme: "system" | "light" | "dark";
    reducedMotion: boolean;
    blurOff: boolean;
}

/** the attributes a look writes on a document root; null removes one */
export function frameLookAttributes(look: FrameLook): [string, string | null][] {
    return [
        ["data-paperui-theme", look.theme === "system" ? null : look.theme],
        ["data-paperui-motion", look.reducedMotion ? "reduced" : "auto"],
        ["data-paperui-blur", look.blurOff ? "off" : "auto"],
    ];
}

export function mobileAttribute(on: boolean): [string, string] {
    return [MOBILE_ATTRIBUTE, on ? "true" : "false"];
}

function isFrameLook(value: unknown): value is FrameLook {
    const look = value as FrameLook | null;
    return typeof look === "object" && look !== null && ["system", "light", "dark"].includes(look.theme)
        && typeof look.reducedMotion === "boolean" && typeof look.blurOff === "boolean";
}

if (typeof window !== "undefined" && window.parent !== window) {
    const write = (attributes: [string, string | null][]) => {
        for (const [name, value] of attributes) {
            if (value === null) document.documentElement.removeAttribute(name);
            else document.documentElement.setAttribute(name, value);
        }
    };
    const writeLook = (look: unknown) => {
        if (!isFrameLook(look)) throw new Error("The shell sent a look without a theme, motion and blur");
        write(frameLookAttributes(look));
    };
    const receive = (event: MessageEvent) => {
        if (event.source !== window.parent || typeof event.data?.type !== "string") return;
        if (event.data.type === "paperboard:initialize") {
            if (typeof event.data.mobile === "boolean") write([mobileAttribute(event.data.mobile)]);
            if (event.data.look !== undefined) writeLook(event.data.look);
        } else if (event.data.generation !== currentFrameSession()?.generation) {
            return;
        } else if (event.data.type === MOBILE_MODE_MESSAGE) {
            if (typeof event.data.mobile !== "boolean") throw new Error("The shell sent mobile mode without a true or false");
            write([mobileAttribute(event.data.mobile)]);
        } else if (event.data.type === FRAME_LOOK_MESSAGE) {
            writeLook(event.data.look);
        }
    };
    window.addEventListener("message", receive);
    window.addEventListener("pagehide", () => window.removeEventListener("message", receive), { once: true });
}
