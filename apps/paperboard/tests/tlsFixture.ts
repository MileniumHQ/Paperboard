// Shared TLS identities for fixtures that stand in for a remote computer's
// daemon. Remote daemons only speak TLS, and clients pin the certificate.
import { createTlsIdentity } from "../papercrane/tlsIdentity";

export const remoteTls = createTlsIdentity();
// a second, unrelated identity: what an impostor on the network presents
export const impostorTls = createTlsIdentity();
