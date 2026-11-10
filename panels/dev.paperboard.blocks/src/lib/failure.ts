// The words for a failure a person is shown: the real message, never a
// generic "something went wrong".
export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
