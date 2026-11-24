import { utils } from "ssh2";

type KeyOptions = Parameters<typeof utils.generateKeyPairSync>[1];

/**
 * An ed25519 key pair ssh2 can read back. ssh2 1.16's generator strips
 * "leading zero bytes" from the public key, so the 1 in 256 keys whose
 * public half starts with 0x00 come out malformed; those are made again.
 */
export function ed25519Pair(options?: KeyOptions): { private: string; public: string } {
    for (;;) {
        const pair = options ? utils.generateKeyPairSync("ed25519", options) : utils.generateKeyPairSync("ed25519");
        const passphrase = (options as { passphrase?: string } | undefined)?.passphrase;
        if (!(utils.parseKey(pair.public) instanceof Error) && !(utils.parseKey(pair.private, passphrase) instanceof Error)) return pair;
    }
}
