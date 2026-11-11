// PaperUI's tokens as values: Blockly draws in numbers and colours, not CSS
// variables, so the blocks read each token from the page once it's styled.

export function token(name: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!value) throw new Error(`${name} isn't set, so blocks can't be drawn`);
    return value;
}

/** A token that's a length in pixels. One written as calc() isn't read: name the pixels it's made of. */
export function tokenPixels(name: string): number {
    const value = parseFloat(token(name));
    if (!Number.isFinite(value)) throw new Error(`${name} isn't a length, so blocks can't be drawn`);
    return value;
}
