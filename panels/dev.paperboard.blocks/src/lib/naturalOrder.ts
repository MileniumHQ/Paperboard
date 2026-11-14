/** Names in the order a person counts them: variable_2 before variable_10. */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

interface VariableBlock {
    kind?: unknown;
    type?: unknown;
    fields?: { VAR?: { id?: unknown } };
}

/**
 * Blockly lists a flyout's variable blocks by a plain name order. This puts the
 * blocks that read a variable in natural order, each where one of them was, so
 * the blocks that set or change one stay at the top.
 */
export function sortVariableReads<T extends VariableBlock>(blocks: T[], nameOf: (id: string) => string): T[] {
    const isRead = (b: T) => b.kind === "block" && b.type === "variables_get" && typeof b.fields?.VAR?.id === "string";
    const reads = blocks.filter(isRead).sort((a, b) => naturalCompare(nameOf(a.fields!.VAR!.id as string), nameOf(b.fields!.VAR!.id as string)));
    let next = 0;
    return blocks.map((b) => (isRead(b) ? reads[next++]! : b));
}
