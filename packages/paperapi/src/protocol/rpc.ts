// The daemon's RPC, declared once: each action's params shape (checked by the
// daemon before its handler runs) and its typed result.
import { shape, type ObjectOf, type ObjectShape, type Shape } from "../shape";
import type { WidgetDeclaration } from "../widgetManifest";
import type { BackupLocation, BackupLocationUsage, BackupProgress, BackupRecord, NewBackupLocation } from "../backups";
import type { PortClaim, PortPolicy } from "../ports";
import type { PanelProblem } from "../problemShape";
import type { GpuInfo, UsageReport } from "../system";
import type { InstalledPackageRecord, PendingPackageUpdate } from "../package";
import type { BlockInfo, BlockProjectInfo, BlockTemplateInfo } from "../blocks";
import type { BlockSchema, BlockTemplateSchema } from "../blocksSchema";
import type { InvalidPanel } from "../panels";
import { anyText, configPath, envMap, flag, id, InvalidParamsError, list, numeric, object, opt, panelId, readValue, text, typed } from "./fields";

/** The longest project picture: a data URL of a 256 KB server icon fits. */
export const MAX_PROJECT_IMAGE = 512 * 1024;
/** The longest label a backup someone makes may carry. */
export const BACKUP_LABEL_MAX = 100;
/** How a workload's input is encoded on its way in. */
export const INPUT_ENCODINGS = ["utf8", "utf16le"] as const;
/** The computer's own folder, the backup location every computer has. */
export const LOCAL_LOCATION_ID = "local";
/** what a backup target may be called: a panel's own id for it */
export const BACKUP_TARGET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LOCATION_ID_RE = /^d-[0-9a-f]{12}$/;
// single-frame write cap: 16 MiB of parsed content is far past any
// legitimate panel state file; larger blobs ride file:download, which
// streams with its own cap instead of living twice in one JSON frame
const FILE_WRITE_MAX = 16 * 1024 * 1024;
// a call to a registry entry waits at most this long; null waits it out
export const CALL_TIMEOUT_MAX_MS = 60_000;
// per-socket broadcast interest is bounded
const MAX_EVENT_SUBS = 512;

export function isLocationId(value: unknown): value is string {
    return typeof value === "string" && (value === LOCAL_LOCATION_ID || LOCATION_ID_RE.test(value));
}

/** An installed panel, as the daemon lists it. */
export interface PanelManifest {
    id: string;
    name: string;
    base?: string;
    icon?: string;
    iconUrl?: string;
    downloadUrl?: string;
    description?: string;
    version?: string;
    publisher?: string;
    size?: string;
    updatedAt?: string;
    isInstalled?: boolean;
    isDevLink?: boolean;
    isLinked?: boolean;
    service?: string;
    autostart?: boolean;
    widgets?: WidgetDeclaration[];
    // kept off the store; installs still update
    unlisted?: boolean;
    // "dev" = symlinked from a working tree; registry installs carry none
    installSource?: "dev";
    // why its service last failed or exited unasked, until it is ready again
    serviceError?: string;
}

/** a shell this computer has, as terminalApi.shells() lists it */
export interface TerminalShell {
    /** the program; pass it as create()'s shell */
    path: string;
    /** what the user calls it ("zsh", "PowerShell 7") */
    name: string;
}

/** Where a panel's backups go, and its target's running backup, as the daemon answers them. */
export interface BackupStatusAnswer {
    location: BackupLocation | null;
    progress: BackupProgress | null;
}

export interface RpcIdentityPart {
    id: string;
    name: string;
    version?: string;
}

export interface RpcOsFacts {
    osVersion?: string;
    distroId?: string;
    distroName?: string;
    flavor?: RpcIdentityPart;
    machine?: RpcIdentityPart;
    board?: string;
    operator?: RpcIdentityPart;
}

// the .local name a computer says it answers to: a hint, kept only once its
// pinned certificate answers there; absent from an older daemon
export interface RpcNetworkFacts {
    mdnsName?: string;
}

export interface RpcSystemFacts extends RpcOsFacts, RpcNetworkFacts {
    hostname: string;
    os: string;
    arch: string;
}

export interface RpcPairingStatus {
    active: boolean;
    computers: Array<{ name?: string; pairedAt: string }>;
}

const nothing = object({});
const supervisedId = () => text(128);
const appId = opt(text(128));
const panelFilter = opt(text(128));

// what a registry entry is named: a kind, a dot and the definition's id,
// optionally inside a project ("server1/command.kick-player"); a template is the panel's, in no project
const ENTRY_PATTERN = /^(?:(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/)?(?:type|command|value|event)|template)\.[a-z0-9][a-z0-9-]{0,63}$/;
const entry = (): Shape<string> => {
    const bounded = text(256);
    return {
        check: (value, at) =>
            bounded.check(value, at, false) ??
            (ENTRY_PATTERN.test(String(value)) ? null : `Parameter "${at}" must name a block entry ("kind.id" or "project/kind.id"), got "${value}"`),
    };
};

// A numeric timeout longer than the cap is refused, not clamped silently.
// An explicit null opts the call out of the deadline entirely — long work
// (installing a runtime) reports progress and completion through panel state
// rather than holding a caller's socket open, but callers that must wait may
// do so. The outstanding-call cap, not the timer, is the budget then.
const callTimeout = (): Shape<number | null> => {
    const n = numeric();
    const reading: Shape<number | null> & { read: (value: unknown) => number | null } = {
        check: (value, at) =>
            value === null ? null : n.check(value, at, false) ?? (Number(value) > CALL_TIMEOUT_MAX_MS ? `Parameter "${at}" exceeds ${CALL_TIMEOUT_MAX_MS} ms cap` : null),
        read: (value) => (value === null ? null : Number(value)),
    };
    return reading;
};

// a definition as the registry lists it; the Blocks panel reads it, the daemon only keeps it
const blockSchema = (): Shape<BlockSchema | BlockTemplateSchema> => ({
    check: (v, at) => (v && typeof v === "object" ? null : `a block needs a "${at}" object`),
});

const locationId = (): Shape<string> => ({
    check: (value, at) => (isLocationId(value) ? null : `Invalid ${at}: ${JSON.stringify(value)}`),
});

const backupTarget = (): Shape<string> => ({
    check: (value, at) => (typeof value === "string" && BACKUP_TARGET_RE.test(value) ? null : `Invalid ${at}: ${JSON.stringify(value)}`),
});

// The event names a socket wants: a list of at most MAX_EVENT_SUBS.
const eventNames = (): Shape<string[]> => {
    const reading: Shape<string[]> & { read: (value: unknown) => string[] } = {
        check: (value, at) => {
            if (!Array.isArray(value)) return `Parameter "${at}" must be a list of event names`;
            return value.length > MAX_EVENT_SUBS ? `Too many event subscriptions (max ${MAX_EVENT_SUBS})` : null;
        },
        read: (value) => (Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : []),
    };
    return reading;
};

// a call that names a panel's backups: the panel, and which of its targets
const backupOf = {
    panelId: panelId(),
    target: shape.optional(backupTarget()),
};

export interface RpcDefinition {
    readonly params: ObjectShape;
    /** host authority only: a panel's scoped credential is refused before its params are read */
    readonly host?: true;
}

export const RPC = {
    // auth: the daemon answers these, and checks authority, before any other action
    "auth:pair": { params: object({ code: shape.optional(shape.json()), clientName: shape.optional(shape.json()) }) },
    "auth:verify": { params: object({ token: shape.optional(shape.json()) }) },
    "auth:scope": { params: object({ panelId: panelId() }) },
    // relayTo names the computer that serves the panel; "local" is this one
    "auth:panel-token": { params: object({ panelId: panelId(), relayTo: shape.optional(text(128)) }) },
    "auth:revoke-self": { params: nothing },

    // the broadcast events this socket hears, replacing what it declared before; [] hears none
    "events:subscribe": { params: object({ events: eventNames() }) },

    // terminals
    "term:create": {
        params: object({ id: supervisedId(), cols: opt(numeric()), rows: opt(numeric()), env: opt(envMap()), cwd: opt(text(1024)), shell: opt(text(1024)) }),
    },
    "term:write": { params: object({ id: supervisedId(), data: text(65536, { empty: true }) }) },
    "term:resize": { params: object({ id: supervisedId(), cols: numeric(), rows: numeric() }) },
    "term:attach": { params: object({ id: supervisedId() }) },
    "term:shells": { params: nothing },
    "term:exists": { params: object({ id: supervisedId() }) },
    "term:destroy": { params: object({ id: supervisedId() }) },

    // processes
    "process:run": {
        params: object({
            id: supervisedId(),
            command: text(),
            args: opt(list(anyText())),
            cwd: opt(text(1024)),
            env: opt(envMap()),
            stdin: shape.optional(shape.boolean()),
            inputEncoding: shape.optional(shape.oneOf(...INPUT_ENCODINGS)),
            consoleInput: shape.optional(shape.boolean()),
            important: shape.optional(shape.boolean()),
        }),
    },
    "process:write": { params: object({ id: supervisedId(), data: text(65536, { empty: true }) }) },
    "process:close-input": { params: object({ id: supervisedId() }) },
    "process:kill": { params: object({ id: supervisedId(), signal: opt(text(32)) }) },
    "process:exists": { params: object({ id: supervisedId() }) },
    "process:attach": { params: object({ id: supervisedId() }) },

    // a panel's files; an empty targetPath is the panel's root, where a path names nothing else
    "file:getPath": { params: object({ targetPath: text(1024, { empty: true }), appId }) },
    "file:exists": { params: object({ targetPath: text(1024, { empty: true }), appId }) },
    "file:write": { params: object({ targetPath: text(1024), content: text(FILE_WRITE_MAX, { empty: true }), appId }) },
    "file:read": { params: object({ targetPath: text(1024), appId }) },
    "file:delete": { params: object({ targetPath: text(1024), appId }) },
    "file:clear": { params: object({ appId }) },
    "file:download": {
        params: object({
            downloadId: text(128),
            url: text(8192),
            targetPath: text(1024),
            appId,
            options: opt(object({ sha1: opt(anyText()), sha256: opt(anyText()), checksum: opt(object({ algorithm: anyText(), value: anyText() })) })),
        }),
    },

    // runtime packages
    "package:isInstalled": { params: object({ packageName: text(128), version: opt(text(64)) }) },
    "package:getIndex": { params: nothing },
    "package:getPath": { params: object({ packageName: text(128) }) },
    "package:download": {
        params: object({ packageName: text(128), downloadId: text(128), sha256: opt(text(128)), allowDowngrade: flag() }),
    },
    "package:pending": { params: nothing },

    // panels
    "panel:list": { params: nothing },
    "service:count": { params: nothing, host: true },
    "panel:install": {
        params: object({ panelId: panelId(), version: opt(text(64)), sha256: opt(text(128)), downloadId: opt(text(128)), allowDowngrade: flag(), ifUnused: flag() }),
        host: true,
    },
    "update:inUse": {
        params: object({
            panels: opt(list(object({ id: panelId(), version: opt(text(64)), sha256: opt(text(128)) }))),
            packages: opt(list(id())),
            downloadId: opt(text(128)),
        }),
        host: true,
    },
    "panel:uninstall": { params: object({ panelId: panelId(), deleteData: flag() }) },
    "panel:restartService": { params: object({ panelId: panelId() }) },
    "config:get": { params: object({ id: id(), path: opt(configPath()) }) },
    "config:set": { params: object({ id: id(), path: opt(configPath()), data: shape.optional(shape.json()) }) },

    // this computer
    "system:ip": { params: nothing },
    "system:info": { params: nothing },
    "system:gpus": { params: nothing },
    "system:usage": { params: nothing },
    "system:pairing-start": { params: nothing },
    "system:pairing-status": { params: nothing },
    "system:pairing-cancel": { params: nothing },
    "system:update": {
        params: object({ downloadUrl: opt(anyText()), sha256: opt(anyText()), version: opt(anyText()), signature: opt(anyText()) }),
    },

    // the vault
    "secrets:set": { params: object({ panelId: panelId(), name: anyText(), value: anyText() }) },
    "secrets:get": { params: object({ panelId: panelId(), name: shape.optional(shape.json()) }) },
    "secrets:delete": { params: object({ panelId: panelId(), name: shape.optional(shape.json()) }) },
    "secrets:list": { params: object({ panelId: panelId() }) },
    "secrets:purge": { params: object({ panelId: panelId() }) },

    // backups
    "backup:locations": { params: nothing, host: true },
    "backup:locations-problem": { params: nothing, host: true },
    "backup:locations-recover": { params: nothing, host: true },
    "backup:location-usage": { params: object({ locationId: locationId() }), host: true },
    "backup:location-add": { params: object({ location: typed<NewBackupLocation>() }), host: true },
    "backup:location-reconnect": {
        params: object({ locationId: locationId(), clientId: anyText(), clientSecret: anyText(), refreshToken: anyText() }),
        host: true,
    },
    "backup:location-remove": { params: object({ locationId: locationId() }), host: true },
    "backup:panel-location-set": { params: object({ panelId: panelId(), locationId: shape.nullable(locationId()) }), host: true },
    "backup:status": { params: object(backupOf) },
    "backup:progress": { params: object({ panelId: panelId() }) },
    "backup:create": { params: object({ ...backupOf, label: opt(text(BACKUP_LABEL_MAX)) }) },
    "backup:list": { params: object(backupOf) },
    "backup:restore": { params: object({ ...backupOf, backupId: text(64) }) },
    "backup:delete": { params: object({ ...backupOf, backupId: text(64) }) },

    // ports
    "ports:claim": {
        params: object({ panelId: panelId(), name: typed<unknown>(), label: typed<unknown>(), protocol: typed<unknown>(), preferred: typed<unknown>(), count: shape.optional(typed<unknown>()) }),
    },
    "ports:prepare": { params: object({ panelId: panelId(), name: shape.optional(typed<unknown>()) }) },
    "ports:release": { params: object({ panelId: panelId(), name: shape.optional(typed<unknown>()) }) },
    "ports:list": { params: object({ panelId: panelId() }) },
    "ports:all": { params: nothing, host: true },
    "ports:policy-set": { params: object({ policy: shape.optional(typed<unknown>()) }), host: true },

    // problems
    "problems:report": {
        params: object({ panelId: panelId(), key: shape.optional(typed<unknown>()), title: shape.optional(typed<unknown>()), message: shape.optional(typed<unknown>()) }),
    },
    "problems:clear": { params: object({ panelId: panelId(), key: shape.optional(typed<unknown>()) }) },
    "problems:clear-prefix": { params: object({ panelId: panelId(), prefix: shape.optional(typed<unknown>()) }) },
    "problems:list": { params: object({ panelId: panelId() }) },
    "problems:every": { params: nothing, host: true },

    // a panel's page says, on its own connection, that it is open; it counts until that connection closes
    "pages:open": { params: object({ panelId: panelId() }) },

    // Blocks
    "blocks:register-set": { params: object({ panelId: panelId(), entries: list(object({ entry: entry(), schema: blockSchema() })) }) },
    // one block at a time, as panels built before blocks:register-set ask; goes at the next protocol version
    "blocks:register": { params: object({ panelId: panelId(), entry: entry(), schema: blockSchema() }) },
    "blocks:unregister": { params: object({ panelId: panelId(), entry: entry() }) },
    "blocks:project-define": {
        params: object({ panelId: panelId(), project: text(64), name: text(128), icon: opt(text(128)), image: opt(text(MAX_PROJECT_IMAGE)) }),
    },
    "blocks:project-remove": { params: object({ panelId: panelId(), project: text(64) }) },
    "blocks:projects": { params: object({ panelId: panelFilter }) },
    "blocks:list": { params: object({ panelId: panelFilter }) },
    "blocks:templates": { params: object({ panelId: panelFilter }) },
    "blocks:call": {
        params: object({ panelId: panelId(), entry: entry(), request: shape.optional(shape.json()), timeoutMs: shape.optional(callTimeout()) }),
    },
    "blocks:emit": { params: object({ panelId: panelId(), entry: entry(), payload: shape.optional(shape.json()) }) },
} as const satisfies Record<string, RpcDefinition>;

type Ack = { success?: boolean };
type Success = { success: boolean };

export interface RpcResults {
    "auth:pair": { success: boolean; token: string } & RpcSystemFacts;
    "auth:verify": { success: boolean; hostname?: string; os?: string; arch?: string } & RpcOsFacts & RpcNetworkFacts;
    "auth:scope": Ack;
    "auth:panel-token": { token: string };
    "auth:revoke-self": { revoked: boolean };
    "events:subscribe": { success?: boolean; count?: number };

    "term:create": Ack;
    "term:write": Ack;
    "term:resize": Ack;
    "term:attach": Success;
    "term:shells": { shells: TerminalShell[] };
    "term:exists": { running: boolean };
    "term:destroy": Ack;

    "process:run": Ack;
    "process:write": Ack;
    "process:close-input": Ack;
    "process:kill": Ack;
    "process:exists": { running: boolean };
    "process:attach": Success;

    "file:getPath": { path: string };
    "file:exists": { exists: boolean };
    "file:write": { path: string };
    "file:read": { content: string | null };
    "file:delete": Success;
    "file:clear": Success;
    "file:download": { path: string };

    "package:isInstalled": { installed: boolean };
    "package:getIndex": { index: Record<string, InstalledPackageRecord | string> };
    "package:getPath": { path: string };
    "package:download": { path: string; waiting?: PendingPackageUpdate };
    "package:pending": { updates: PendingPackageUpdate[] };

    "panel:list": { panels: PanelManifest[]; invalid?: InvalidPanel[] };
    "service:count": { running: number };
    "panel:install": { panel?: PanelManifest; held?: { processes: string[] } };
    "update:inUse": { panels: PanelManifest[]; failures: Record<string, string> };
    "panel:uninstall": { success: boolean; packagesWarning?: string };
    "panel:restartService": { restarted: boolean };
    "config:get": { data: unknown };
    "config:set": Success;

    "system:ip": { ip: string };
    "system:info": { service?: string; version?: string; ip?: string; username?: string } & RpcSystemFacts;
    "system:gpus": { gpus: GpuInfo[]; errors: string[] };
    "system:usage": UsageReport;
    "system:pairing-start": { code: string };
    "system:pairing-status": RpcPairingStatus;
    "system:pairing-cancel": { cancelled: boolean };
    "system:update": { accepted?: boolean; status?: string; restartRequired?: boolean; message?: string };

    "secrets:set": Success;
    "secrets:get": { found: boolean; value?: string | null };
    "secrets:delete": { deleted: boolean };
    "secrets:list": { keys: string[] };
    "secrets:purge": { purged: number };

    "backup:locations": { locations: BackupLocation[] };
    "backup:locations-problem": { problem?: string | null };
    "backup:locations-recover": { keptAs: string };
    "backup:location-usage": BackupLocationUsage;
    "backup:location-add": BackupLocation;
    "backup:location-reconnect": BackupLocation;
    "backup:location-remove": Ack;
    "backup:panel-location-set": BackupStatusAnswer;
    "backup:status": BackupStatusAnswer;
    "backup:progress": { progress: BackupProgress[] };
    "backup:create": BackupRecord;
    "backup:list": { backups: BackupRecord[] };
    "backup:restore": BackupRecord;
    "backup:delete": Ack;

    "ports:claim": PortClaim;
    "ports:prepare": PortClaim;
    "ports:release": Ack;
    "ports:list": { claims: PortClaim[] };
    "ports:all": { claims: PortClaim[]; policy: PortPolicy };
    "ports:policy-set": { policy: PortPolicy };

    "problems:report": Ack;
    "problems:clear": Ack;
    "problems:clear-prefix": Ack;
    "problems:list": { problems: PanelProblem[] };
    "problems:every": { panels: Record<string, PanelProblem[]> };

    "pages:open": Ack;

    "blocks:register-set": Ack;
    "blocks:register": Ack;
    "blocks:unregister": Ack;
    "blocks:project-define": Ack;
    "blocks:project-remove": Ack;
    "blocks:projects": { projects: BlockProjectInfo[] };
    "blocks:list": { entries: BlockInfo[] };
    "blocks:templates": { templates: BlockTemplateInfo[] };
    "blocks:call": { result: unknown };
    "blocks:emit": Ack;
}

export type RpcAction = keyof typeof RPC;
/** An action's params, as its handler is given them and its caller sends them. */
export type RpcParams<A extends RpcAction> = (typeof RPC)[A]["params"] extends ObjectShape<infer F> ? ObjectOf<F> : never;
/** What an action answers. */
export type RpcResult<A extends RpcAction> = RpcResults[A];

export function isRpcAction(action: unknown): action is RpcAction {
    return typeof action === "string" && Object.hasOwn(RPC, action);
}

/**
 * A call's params as its handler is given them, or an InvalidParamsError
 * naming the action and the field. Params that aren't an object read as
 * none: an action that needs one is refused for the field it misses.
 */
export function readParams<A extends RpcAction>(action: A, params: unknown): RpcParams<A> {
    const given = typeof params === "object" && params !== null && !Array.isArray(params) ? params : {};
    try {
        const definition: RpcDefinition = RPC[action];
        return readValue(definition.params, given, "") as RpcParams<A>;
    } catch (err) {
        if (err instanceof InvalidParamsError) throw new InvalidParamsError(`${err.message} (in ${action})`);
        throw err;
    }
}
