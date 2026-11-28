// Shared documents: the settings and documents a panel keeps on every
// computer of the network, as records in the record store (store.ts). What
// a panel keeps on one computer alone is its config (engine config), which
// this does not touch.
//
// ─── Spaces ──────────────────────────────────────────────────────────────────
//
//   "panel:<h>"  one panel's documents; h is the first 20 bytes of
//                SHA-256("paperboard-panel-space" ‖ 0x00 ‖ panel id), as 40
//                lowercase hex characters: a panel id is up to 128
//                characters and a space name 64. It is not secret: a relay
//                can hash the panel ids it knows.
//   "shell"      the shell's own shared settings: the host's alone
//
// The space is chosen by the caller's credential (rpc/shared.ts), never by
// a name a caller gives, so a panel reaches its own space and nothing else:
// not another panel's, not the shell's, not the store's "@" spaces. A
// document's id is the record's: like every record header, it is readable
// to a relay that carries it; its value is not.
//
// ─── Conflicts ───────────────────────────────────────────────────────────────
//
// A write always succeeds (within the limits) and wins until a later one,
// here or on another computer, replaces it (store.ts: last writer wins, with
// the version each other computer wrote kept). A write may say the version
// it was `basedOn`; when the version it replaced is another, it still
// succeeds, and its answer names what it overwrote. A refusal instead would
// only see what this computer has heard of: two computers apart both pass
// any check and conflict later all the same. So the store's kept versions
// are where a conflict's loser goes, and the answer and the watch say so.
//
// ─── Limits ──────────────────────────────────────────────────────────────────
//
// Checked here for this computer's writes, in the store's line
// (RecordStore.write): a document's size, the documents a panel holds, the
// ids it has used (a delete is a record too) and all its documents' bytes
// (sharedShape.ts). Records from other computers are never refused for
// them: every computer applies the same checks to its own writes, and
// refusing a peer's record would leave computers disagreeing.
import * as crypto from "crypto";
import {
    SHARED_DOCUMENT_MAX_BYTES,
    SHARED_DOCUMENTS_MAX,
    SHARED_IDS_MAX,
    SHARED_SPACE_MAX_BYTES,
    type SharedAuthor,
    type SharedDelete,
    type SharedDocument,
    type SharedVersion,
    type SharedWrite,
} from "@mileniumhq/paperapi/sharedShape";
import { ErrorCode } from "../core/protocol";
import { SEALED_OVERHEAD } from "./record";
import type { RecordStore, StoredRecord } from "./store";

export const SHELL_SPACE = "shell";

/** the space a panel's documents are kept in */
export function panelSpace(panelId: string): string {
    return `panel:${crypto.createHash("sha256").update(`paperboard-panel-space\0${panelId}`, "utf8").digest("hex").slice(0, 40)}`;
}

/** Whose documents a call reaches: a panel's, or (null) the shell's. */
export interface SharedOwner {
    panelId: string | null;
    space: string;
}

export function ownerOf(panelId: string | null): SharedOwner {
    return { panelId, space: panelId === null ? SHELL_SPACE : panelSpace(panelId) };
}

/** A write the limits refuse, or a restore of a version a document doesn't have; typed by its code on the wire. */
export class SharedRefusal extends Error {
    readonly code: typeof ErrorCode.INVALID_PARAMS | typeof ErrorCode.NOT_FOUND;
    constructor(kind: "limit" | "missing" | "invalid", message: string) {
        super(message);
        this.name = "SharedRefusal";
        this.code = kind === "missing" ? ErrorCode.NOT_FOUND : ErrorCode.INVALID_PARAMS;
    }
}

export interface SharedDocumentsOptions {
    store: RecordStore;
    /** the name the computer list gives a member, if any */
    nameOf(memberId: string): string | undefined;
}

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

export class SharedDocuments {
    private readonly store: RecordStore;
    private readonly nameOf: (memberId: string) => string | undefined;
    private readonly watched = new Map<string, () => void>();
    private readonly listeners = new Set<(owner: SharedOwner, ids: string[]) => void>();

    constructor(options: SharedDocumentsOptions) {
        this.store = options.store;
        this.nameOf = options.nameOf;
    }

    get(owner: SharedOwner, id: string): SharedDocument | null {
        this.follow(owner);
        const record = this.store.get(owner.space, id);
        return record && this.document(record);
    }

    /** the owner's documents by id; only `ids` when given, only those starting with `prefix` when given */
    list(owner: SharedOwner, { prefix, ids }: { prefix?: string; ids?: string[] } = {}): SharedDocument[] {
        this.follow(owner);
        const records = ids ? [...new Set(ids)].sort().flatMap((id) => this.store.get(owner.space, id) ?? []) : this.store.list(owner.space);
        return records.filter((r) => prefix === undefined || r.id.startsWith(prefix)).flatMap((r) => this.document(r) ?? []);
    }

    versions(owner: SharedOwner, id: string): SharedVersion[] {
        this.follow(owner);
        return this.store.versions(owner.space, id).map((r) => this.version(r));
    }

    async set(owner: SharedOwner, id: string, value: unknown, basedOn?: string | null): Promise<SharedWrite> {
        this.follow(owner);
        const size = jsonBytes(value);
        if (size > SHARED_DOCUMENT_MAX_BYTES) {
            throw new SharedRefusal("limit", `The shared document "${id}" is ${size} bytes; a shared document holds at most ${SHARED_DOCUMENT_MAX_BYTES}. Shared documents are for settings and documents: keep bulk data in the panel's files.`);
        }
        const { written, replaced } = await this.store.write(owner.space, id, (current) => {
            this.admit(owner, id, current, size);
            return { value };
        });
        if (!written || written.state === "deleted") throw new Error(`The shared document "${id}" was not written`);
        return { document: this.live(written), overwrote: this.overwrote(replaced, basedOn) };
    }

    async delete(owner: SharedOwner, id: string, basedOn?: string | null): Promise<SharedDelete> {
        this.follow(owner);
        const { written, replaced } = await this.store.write(owner.space, id, (current) => (current && current.state !== "deleted" ? { deleted: true } : null));
        return { deleted: written !== null, overwrote: this.overwrote(replaced, basedOn) };
    }

    /** Makes an earlier version the document again, as a new write; a deleted one deletes it. */
    async restore(owner: SharedOwner, id: string, version: string): Promise<SharedDocument | null> {
        this.follow(owner);
        const { written } = await this.store.write(owner.space, id, (current) => {
            const found = this.store.versions(owner.space, id).find((v) => v.version === version);
            if (!found) throw new SharedRefusal("missing", `The shared document "${id}" has no version ${version}`);
            if (found.version === current?.version) throw new SharedRefusal("invalid", `Version ${version} of "${id}" is already the current one`);
            if (found.state === "unreadable") throw new SharedRefusal("invalid", `Version ${version} of "${id}" can't be read on this computer: ${found.error}`);
            if (found.state === "deleted") return current?.state === "deleted" ? null : { deleted: true };
            this.admit(owner, id, current, jsonBytes(found.value));
            return { value: found.value };
        });
        return written && written.state !== "deleted" ? this.live(written) : null;
    }

    /** hears every change to any owner's documents this computer has been asked about; returns the unsubscribe */
    onChange(listener: (owner: SharedOwner, ids: string[]) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    close(): void {
        for (const unwatch of this.watched.values()) unwatch();
        this.watched.clear();
        this.listeners.clear();
    }

    /**
     * Watches the owner's space from its first call on. A page reads before
     * it hears (shared.ts in PaperAPI), so nothing it could have been told
     * of comes before that; one space per panel asked about, and the shell's.
     */
    private follow(owner: SharedOwner): void {
        if (this.watched.has(owner.space)) return;
        this.watched.set(
            owner.space,
            this.store.watch(owner.space, (ids) => {
                for (const listener of this.listeners) listener(owner, ids);
            }),
        );
    }

    /** the limits, for a write of `size` bytes of JSON over `current` */
    private admit(owner: SharedOwner, id: string, current: StoredRecord | null, size: number): void {
        const whose = owner.panelId === null ? "Paperboard's shared settings" : `${owner.panelId}'s shared documents`;
        const usage = this.store.usage(owner.space, id);
        if (!current && usage.ids >= SHARED_IDS_MAX) {
            throw new SharedRefusal("limit", `${whose} have used ${SHARED_IDS_MAX} document ids, deleted ones included; a new document needs an id used before.`);
        }
        if ((!current || current.state === "deleted") && usage.live >= SHARED_DOCUMENTS_MAX) {
            throw new SharedRefusal("limit", `${whose} hold ${SHARED_DOCUMENTS_MAX} documents, the most there can be; delete one first.`);
        }
        const total = usage.bytes - usage.idBytes + size + SEALED_OVERHEAD;
        if (total > SHARED_SPACE_MAX_BYTES) {
            throw new SharedRefusal("limit", `${whose} would hold ${total} bytes with this write; they hold at most ${SHARED_SPACE_MAX_BYTES}.`);
        }
    }

    /** what a write replaced, when it wasn't what the write was based on */
    private overwrote(replaced: StoredRecord | null, basedOn: string | null | undefined): SharedVersion | null {
        if (basedOn === undefined) return null;
        const absent = replaced === null || replaced.state === "deleted";
        if (basedOn === null ? absent : replaced?.version === basedOn) return null;
        return replaced && this.version(replaced);
    }

    private author(memberId: string): SharedAuthor {
        const name = this.nameOf(memberId);
        return { computer: memberId, ...(name === undefined ? {} : { name }), self: memberId === this.store.self };
    }

    private version(r: StoredRecord): SharedVersion {
        if (r.state !== "deleted") return this.live(r);
        return { id: r.id, version: r.version, author: this.author(r.author), writtenAt: r.wall, state: "deleted" };
    }

    private live(r: StoredRecord & { state: "value" | "unreadable" }): SharedDocument {
        const meta = { id: r.id, version: r.version, author: this.author(r.author), writtenAt: r.wall };
        return r.state === "value" ? { ...meta, state: "value", value: r.value } : { ...meta, state: "unreadable", error: r.error };
    }

    private document(r: StoredRecord): SharedDocument | null {
        return r.state === "deleted" ? null : this.live(r);
    }
}
