// A panel's shared documents: settings and documents every computer of the
// network holds, kept by each computer's Paperboard Server and carried
// between them. configApi is the other kind, kept on one computer. The
// daemon's network/shared.ts says how they are kept, and which panel's they
// are: the caller's credential decides, never a name given here.
import { getTransport, RPC_ROUTES } from "./ipc";
import type { RpcParams } from "./protocol";
import { errorMessage } from "./errors";
import { requirePanelId } from "./panelIdentity";
import {
    SHARED_DOCUMENT_MAX_BYTES,
    SHARED_DOCUMENTS_MAX,
    SHARED_EVENT,
    isSharedVersion,
    requireSharedId,
    requireSharedPrefix,
    type SharedDelete,
    type SharedDocument,
    type SharedVersion,
    type SharedWrite,
} from "./sharedShape";

export {
    SHARED_DOCUMENT_MAX_BYTES,
    SHARED_DOCUMENTS_MAX,
    SHARED_IDS_MAX,
    SHARED_SPACE_MAX_BYTES,
    SHARED_ID_MAX_LENGTH,
    isSharedId,
    type SharedAuthor,
    type SharedDelete,
    type SharedDocument,
    type SharedVersion,
    type SharedWrite,
} from "./sharedShape";

/** One document that changed: as it is now, or null once it is deleted. */
export interface SharedChange<T> {
    id: string;
    document: SharedDocument<T> | null;
}

/** What a watch hears: every document, and what changed since it last heard. */
export interface SharedSnapshot<T> {
    /** every document, by id */
    documents: SharedDocument<T>[];
    /** what changed since the last call; the first call lists every document */
    changes: SharedChange<T>[];
}

export interface SharedWriteOptions {
    /**
     * The version the change was made on (a document's `version`), or null
     * when it was made on no document. When something else was replaced
     * (another computer's change, another window's), the write still wins,
     * and its answer's `overwrote` names what it replaced.
     */
    basedOn?: string | null;
}

/** One owner's shared documents, each value read by its reader. */
export interface SharedDocuments<T> {
    /** the document, or null when there is none */
    get(id: string): Promise<SharedDocument<T> | null>;
    /** every document, by id; with a prefix, the ones whose id starts with it */
    list(options?: { prefix?: string }): Promise<SharedDocument<T>[]>;
    /** writes the whole document; it reaches the other computers as they connect */
    set(id: string, value: T, options?: SharedWriteOptions): Promise<SharedWrite<T>>;
    delete(id: string, options?: SharedWriteOptions): Promise<SharedDelete<T>>;
    /** the kept versions, the current one first: one per computer that wrote it, deletes included */
    versions(id: string): Promise<SharedVersion<T>[]>;
    /** makes an earlier version the document again, as a new write; one that was a delete deletes it (null) */
    restore(id: string, version: string): Promise<SharedDocument<T> | null>;
    /**
     * Hears the documents now and each time one changes, here or on
     * another computer. A read that fails goes to onError and is tried
     * again when the connection comes back. Returns the unsubscribe.
     */
    watch(listener: (snapshot: SharedSnapshot<T>) => void, onError: (err: unknown) => void, options?: { prefix?: string }): () => void;
}

const encoder = new TextEncoder();

/** The value as the reader reads it, or, when the reader refuses it, unreadable with the reader's reason. */
function readDocument<T>(doc: SharedDocument<unknown>, read: (value: unknown) => T): SharedDocument<T> {
    if (doc.state === "unreadable") return doc;
    try {
        return { ...doc, value: read(doc.value) };
    } catch (err) {
        // quiet: a value the reader refuses is said to be unreadable, with the reader's reason
        const { value: _value, ...meta } = doc;
        return { ...meta, state: "unreadable", error: errorMessage(err) };
    }
}

function readVersion<T>(version: SharedVersion<unknown>, read: (value: unknown) => T): SharedVersion<T> {
    return version.state === "deleted" ? version : readDocument(version, read);
}

function writeOptions(options: SharedWriteOptions | undefined): { basedOn?: string | null } {
    const basedOn = options?.basedOn;
    if (basedOn === undefined) return {};
    if (basedOn !== null && !isSharedVersion(basedOn)) throw new Error(`basedOn must be a document's version or null, not ${JSON.stringify(basedOn)}`);
    return { basedOn };
}

function documentsOf<T>(panelId: string | undefined, read: (value: unknown) => T, scope: string | undefined): SharedDocuments<T> {
    if (typeof read !== "function") throw new Error("Shared documents need a reader: a function that checks a saved value and returns it, or throws why it isn't one");
    // a host's call names no panel for the shell's own documents
    const owner = panelId === undefined ? {} : { panelId };
    const docs: SharedDocuments<T> = {
        get: async (id) => {
            const doc = await RPC_ROUTES["shared-get"].call(scope, { ...owner, id: requireSharedId(id) });
            return doc && readDocument(doc, read);
        },
        list: async (options) => {
            const prefix = options?.prefix === undefined ? undefined : requireSharedPrefix(options.prefix);
            const list = await RPC_ROUTES["shared-list"].call(scope, { ...owner, prefix });
            return list.map((doc) => readDocument(doc, read));
        },
        set: async (id, value, options) => {
            if (value === undefined) throw new Error("A shared document's value can't be undefined: delete() removes one");
            const json = JSON.stringify(value);
            if (json === undefined) throw new Error("A shared document's value must be JSON");
            const size = encoder.encode(json).length;
            if (size > SHARED_DOCUMENT_MAX_BYTES) {
                throw new Error(`The shared document "${id}" is ${size} bytes; a shared document holds at most ${SHARED_DOCUMENT_MAX_BYTES}. Keep bulk data in the panel's files.`);
            }
            const params: RpcParams<"shared:set"> = { ...owner, id: requireSharedId(id), value, ...writeOptions(options) };
            const answer = await RPC_ROUTES["shared-set"].call(scope, params);
            return { document: readDocument(answer.document, read), overwrote: answer.overwrote && readVersion(answer.overwrote, read) };
        },
        delete: async (id, options) => {
            const answer = await RPC_ROUTES["shared-delete"].call(scope, { ...owner, id: requireSharedId(id), ...writeOptions(options) });
            return { deleted: answer.deleted, overwrote: answer.overwrote && readVersion(answer.overwrote, read) };
        },
        versions: async (id) => {
            const versions = await RPC_ROUTES["shared-versions"].call(scope, { ...owner, id: requireSharedId(id) });
            return versions.map((v) => readVersion(v, read));
        },
        restore: async (id, version) => {
            if (!isSharedVersion(version)) throw new Error(`Invalid shared document version ${JSON.stringify(version)}`);
            const doc = await RPC_ROUTES["shared-restore"].call(scope, { ...owner, id: requireSharedId(id), version });
            return doc && readDocument(doc, read);
        },
        watch: (listener, onError, options) => watch(panelId ?? null, owner, read, scope, listener, onError, options?.prefix === undefined ? undefined : requireSharedPrefix(options.prefix)),
    };
    return docs;
}

/**
 * The documents, read whole once the event is heard and again on each
 * reconnect, and the ones each change names read again. Reads run one at a
 * time, in the order they were asked for, so an answer is never older than
 * one applied before it; a whole read drops every read waiting behind it.
 */
function watch<T>(
    ownerId: string | null,
    owner: { panelId?: string },
    read: (value: unknown) => T,
    scope: string | undefined,
    listener: (snapshot: SharedSnapshot<T>) => void,
    onError: (err: unknown) => void,
    prefix: string | undefined,
): () => void {
    const transport = getTransport(scope);
    const docs = new Map<string, SharedDocument<T>>();
    const pending = new Set<string>();
    let live = true;
    let reloadWanted = true;
    let running = false;
    // a read asked for before the newest whole read was wanted is dropped
    let generation = 0;
    let heard = false;

    const snapshot = (changes: SharedChange<T>[]) => {
        const documents = [...docs.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, doc]) => doc);
        listener({ documents, changes });
    };
    const apply = (id: string, doc: SharedDocument<T> | null, changes: SharedChange<T>[]) => {
        const before = docs.get(id);
        if (before?.version === doc?.version && before?.state === doc?.state) return;
        if (doc) docs.set(id, doc);
        else docs.delete(id);
        changes.push({ id, document: doc });
    };

    const reload = async () => {
        const mine = generation;
        await transport.subscriptionsSettled();
        const list = await RPC_ROUTES["shared-list"].call(scope, { ...owner, prefix });
        if (!live || mine !== generation) return;
        const now = new Map(list.map((doc) => [doc.id, readDocument(doc, read)]));
        const changes: SharedChange<T>[] = [];
        for (const id of [...docs.keys()]) if (!now.has(id)) apply(id, null, changes);
        for (const [id, doc] of now) apply(id, doc, changes);
        // the first answer is said even when there is nothing: the page knows it has read
        if (!heard || changes.length) snapshot(changes);
        heard = true;
    };
    const fetch = async (ids: string[]) => {
        const mine = generation;
        const list = await RPC_ROUTES["shared-list"].call(scope, { ...owner, ids });
        if (!live || mine !== generation) return;
        const found = new Map(list.map((doc) => [doc.id, readDocument(doc, read)]));
        const changes: SharedChange<T>[] = [];
        for (const id of ids) apply(id, found.get(id) ?? null, changes);
        if (changes.length) snapshot(changes);
    };

    const wantReload = () => {
        generation++;
        reloadWanted = true;
    };
    const pump = async () => {
        if (running) return;
        running = true;
        try {
            while (live && (reloadWanted || pending.size)) {
                if (reloadWanted) {
                    reloadWanted = false;
                    // the whole read covers every change heard before it
                    pending.clear();
                    await reload();
                    continue;
                }
                const ids = [...pending].slice(0, SHARED_DOCUMENTS_MAX);
                for (const id of ids) pending.delete(id);
                await fetch(ids);
            }
        } catch (err) {
            // the reconnect or the next change reads everything again
            wantReload();
            if (live) onError(err);
        } finally {
            running = false;
        }
    };

    // the daemon answers a read and sends its events in the order they
    // happen, on this one connection: an event heard after a read's answer
    // is newer than it
    const off = transport.subscribeEvent(SHARED_EVENT, (change) => {
        if (!live || change.panelId !== ownerId) return;
        for (const id of change.ids) if (prefix === undefined || id.startsWith(prefix)) pending.add(id);
        if (pending.size) void pump();
    });
    const status = (s: { connected: boolean }) => {
        if (!s.connected) return;
        wantReload();
        void pump();
    };
    transport.onStatus(status);
    void pump();
    return () => {
        live = false;
        off();
        transport.offStatus(status);
    };
}

export const sharedApi = {
    /**
     * A panel's shared documents. `read` checks each saved value and returns
     * it as T, or throws why it isn't one (a document saved by a newer
     * version): that document is then unreadable, with the reason.
     */
    panel: <T>(panelId: string, read: (value: unknown) => T, scope?: string): SharedDocuments<T> => documentsOf(requirePanelId(panelId), read, scope),
    /** Paperboard's own shared settings, which no panel reaches: it needs the host's credential, and a panel's is refused. */
    shell: <T>(read: (value: unknown) => T, scope?: string): SharedDocuments<T> => documentsOf(undefined, read, scope),
};
