/** what a caught failure says, for the person to read */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
