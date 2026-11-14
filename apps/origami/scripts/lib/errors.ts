/** What a thrown value says, for an error line. */
export function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
