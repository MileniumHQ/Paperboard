/** A name for a location the user didn't name: the provider's own name, or
 * "<name> 2", "<name> 3"... when the computer already has one by that name. */
export function uniqueLocationLabel(base: string, taken: readonly string[]): string {
    const names = new Set(taken);
    if (!names.has(base)) return base;
    for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}
