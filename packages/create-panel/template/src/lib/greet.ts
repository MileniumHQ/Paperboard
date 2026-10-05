// Pure greeting validation + formatting. Pure so the service action stays a
// thin wire and the boundary rules are unit-tested without a daemon.
export function buildGreeting(rawName: unknown): string {
    const name = String(rawName ?? "").trim();
    if (!name) {
        throw new Error("Name is required");
    }
    if (name.length > 64) {
        throw new Error("Name must be 64 characters or fewer");
    }
    return `Hello, ${name}!`;
}
