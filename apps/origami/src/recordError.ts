// A record that exists but can't be read. The message is the caller's
// answer: it names the record, never the KV error behind it, which the
// thrower logs. Answering 404 instead would tell an updater the record was
// never published.
export class UnreadableRecordError extends Error {
    constructor(what: string) {
        super(`The registry record for ${what} could not be read`);
        this.name = "UnreadableRecordError";
    }
}

// The registry holds more than a listing can answer. Answering the part that
// fits would quietly drop the rest from every reader, so the request fails
// and says so.
export class RegistryLimitError extends Error {
    constructor(what: string) {
        super(`The registry holds ${what}`);
        this.name = "RegistryLimitError";
    }
}
