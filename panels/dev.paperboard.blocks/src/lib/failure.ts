// The words for a failure a person is shown: the real message, never a
// generic "something went wrong".
export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** What a run that was stopped says, wherever it was when Stop came. */
export const RUN_STOPPED = "The run was stopped";
