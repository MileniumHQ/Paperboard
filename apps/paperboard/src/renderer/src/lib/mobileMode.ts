// Mobile mode as the shell knows it: from the launch options, once they are
// read. The shell's own document carries it as PaperUI's data-paper-mobile
// (so its CSS and paperMobile() agree with every panel), and each panel and
// widget frame is told, when it is challenged and whenever it changes. Null
// until it is known.
import { createSignal } from "solid-js";
import { setPaperMobile } from "@mileniumhq/paperui";

/** the message a shell sends a panel frame when mobile mode turns on or off (PaperAPI's MOBILE_MODE_MESSAGE) */
export { MOBILE_MODE_MESSAGE } from "@mileniumhq/paperapi";

const [mobileMode, setMode] = createSignal<boolean | null>(null);

export { mobileMode };

export function setMobileMode(on: boolean): void {
    setMode(on);
    setPaperMobile(on);
}

/** mobile mode for a frame being told; throws before the launch options are read */
export function requireMobileMode(): boolean {
    const on = mobileMode();
    if (on === null) throw new Error("A panel frame was told about mobile mode before the launch options were read");
    return on;
}
