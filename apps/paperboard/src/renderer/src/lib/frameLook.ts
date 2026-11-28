// How the shell's frames look, as the shell knows it: mobile mode, the host's
// to say (App's `mobileMode`), and the theme, motion and blur the person
// chose (App Settings). App sets both before it draws anything. The shell's
// own document carries mobile mode as PaperUI's data-paper-mobile (so its CSS
// and paperMobile() agree with every panel), and each panel and widget frame
// is told, when it is challenged and whenever they change. Null only before
// App starts.
import { createSignal } from "solid-js";
import { setPaperMobile } from "@mileniumhq/paperui";
import type { FrameLook } from "@mileniumhq/paperapi";

export { FRAME_LOOK_MESSAGE, MOBILE_MODE_MESSAGE } from "@mileniumhq/paperapi";

const [mobileMode, setMode] = createSignal<boolean | null>(null);
const [frameLook, setLook] = createSignal<FrameLook | null>(null, {
    equals: (a, b) => a?.theme === b?.theme && a?.reducedMotion === b?.reducedMotion && a?.blurOff === b?.blurOff,
});

export { mobileMode, frameLook };

export function setMobileMode(on: boolean): void {
    setMode(on);
    setPaperMobile(on);
}

export function setFrameLook(look: FrameLook): void {
    setLook(look);
}

/** what a frame being challenged is told; throws if App hasn't set it */
export function requireFrameState(): { mobile: boolean; look: FrameLook } {
    const mobile = mobileMode();
    const look = frameLook();
    if (mobile === null || look === null) throw new Error("A panel frame was told how to look before App set it");
    return { mobile, look };
}
