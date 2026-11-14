// The Workers types the publish flows reach through apps/origami's code,
// which is written against them. Only these: the whole Workers global scope
// would replace Node's Buffer and stream types, which the rest of scripts/
// is written against.
import type * as Cloudflare from "@cloudflare/workers-types/index.ts";

declare global {
    type KVNamespace<Key extends string = string> = Cloudflare.KVNamespace<Key>;
    type KVNamespaceListResult<Metadata, Key extends string = string> = Cloudflare.KVNamespaceListResult<Metadata, Key>;
    // Workers (and Bun, which runs these scripts) digest any byte view
    interface SubtleCrypto {
        digest(algorithm: string | { name: string }, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer>;
    }
}
