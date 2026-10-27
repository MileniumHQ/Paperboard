// What the UI shows when something happens: a title that names it, and the
// detail. A failure's detail is the error's own message, never a pointer to
// the console.
export interface Outcome {
    title: string;
    message: string;
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
