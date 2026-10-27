/** A failed action, as the panel shows it: what didn't happen, and why. */
export interface Outcome {
    title: string;
    message: string;
}

export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
