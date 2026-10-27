// A failure as the person is shown it: which operation didn't happen, and
// the service's own reason.

export interface Failure {
    /** the operation that didn't happen, like "Model not changed" */
    title: string;
    message: string;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const failure = (title: string, e: unknown): Failure => ({ title, message: errorText(e) });
