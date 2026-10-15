import type { JSX } from "solid-js";
import { PaperIcon } from "@mileniumhq/paperui";

/** A computer's icon, as the rail and its Computer Info page show it: this
 * machine is a computer glyph, a paired one its name's first two letters. */
export function computerIcon(comp: { name?: string; isLocal?: boolean }): JSX.Element | string {
    if (comp.isLocal) return "computer";
    return <PaperIcon monogram>{(comp.name || "C").trim().slice(0, 2).toUpperCase()}</PaperIcon>;
}
