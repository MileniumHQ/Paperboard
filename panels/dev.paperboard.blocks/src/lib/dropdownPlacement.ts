// A dropdown opens directly under the field it belongs to, left edges lined
// up, as PaperSelectMenu's list sits under its button. Blockly centres it
// under the field and slides it in; once it has opened, it's moved under the
// field (or over it, when there's no room below) and PaperUI's scale-in
// (App.module.css) is all the motion it has.
import * as Blockly from "blockly";
import { tokenPixels } from "./tokens";

function placeUnder(field: Blockly.Field): void {
    const div = Blockly.DropDownDiv.getContentDiv().parentElement;
    const anchor = field.getSvgRoot();
    if (!div || !anchor) throw new Error("The dropdown opened without its field on the page");
    const gap = tokenPixels("--paper-uigap") / 4;
    const button = anchor.getBoundingClientRect();
    const height = div.offsetHeight;
    const width = div.offsetWidth;
    // the dropdown's position is from its own parent, as Blockly sets it
    const parent = (div.offsetParent ?? document.body).getBoundingClientRect();
    const below = button.bottom + gap + height <= window.innerHeight;
    const top = below ? button.bottom + gap : button.top - gap - height;
    const left = Math.min(button.left, window.innerWidth - width - gap);
    div.style.left = `${Math.max(gap, left) - parent.left}px`;
    div.style.top = `${Math.max(gap, top) - parent.top}px`;
    div.style.transform = "none";
}

let done = false;

/** Opens every dropdown under its field. Once per page: it's Blockly's dropdown, shared by every workspace. */
export function paperDropdowns(): void {
    if (done) return;
    done = true;
    const proto = Blockly.FieldDropdown.prototype as unknown as { showEditor_(this: Blockly.FieldDropdown, e?: MouseEvent): void };
    const open = proto.showEditor_;
    proto.showEditor_ = function (e?: MouseEvent) {
        open.call(this, e);
        placeUnder(this);
    };
}
