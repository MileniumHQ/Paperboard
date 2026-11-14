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
