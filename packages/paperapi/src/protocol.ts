// Wire protocol version shared with the PaperCrane daemon.
// Must equal papercrane/protocol.ts PROTOCOL_VERSION (pinned by the
// cross-repo version parity test and tests/clientParity.test.ts in
// Paperboard). One constant per repo until the monorepo makes it one
// package — never a second hardcoded literal at a call site.
export const PROTOCOL_VERSION = 2;
