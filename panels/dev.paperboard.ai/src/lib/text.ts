/** Cut text to at most `max` characters, ending in an ellipsis when anything was cut. */
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
