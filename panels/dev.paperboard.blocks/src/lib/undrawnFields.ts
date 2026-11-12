// Blockly updates a field's screen-reader text whenever its value is set, and
// finds out a field isn't drawn yet by catching the error asking for its
// element throws. Every field of a loading project is set before it's drawn,
// and making each of those errors' stack traces is most of the time a slow
// computer takes to open a big project. A field's element is the group it
// draws into, so a field without one is skipped before the throw; once
// drawn, Blockly's own update runs as before.
import * as Blockly from "blockly";

const recomputeAriaContext = Blockly.Field.prototype.recomputeAriaContext;

Blockly.Field.prototype.recomputeAriaContext = function (this: Blockly.Field): boolean {
    if (!(this as unknown as { fieldGroup_: SVGGElement | null }).fieldGroup_) return false;
    return recomputeAriaContext.call(this);
};
