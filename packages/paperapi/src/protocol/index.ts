// The wire protocol PaperAPI's transport and the PaperCrane daemon share:
// its version, each RPC action's params and answer (rpc.ts), and each pushed
// event's payload (events.ts). The daemon, the shell, the CLI and PaperAPI's
// own transport all read the wire through it.
export * from "./fields";
export * from "./rpc";
export * from "./events";

// Must equal apps/daemon/src/core/protocol.ts PROTOCOL_VERSION (pinned by the
// cross-repo version parity test and tests/clientParity.test.ts in
// Paperboard). One constant per repo until the monorepo makes it one
// package — never a second hardcoded literal at a call site.
export const PROTOCOL_VERSION = 2;
