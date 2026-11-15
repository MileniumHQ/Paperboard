// The daemon's RPC, declared once: each action's params and what it answers.
// The daemon checks a call's params against its shape before the handler
// runs (rpc/dispatch.ts), and the shell's client checks each answer it reads
// (PaperCraneConnection.call), so neither side casts.
//
// Version skew: a shell and a daemon of different releases talk to each
// other, and the protocol version (protocol.ts) only changes when the wire
// does. So the shapes here never refuse what the daemon used to serve:
// fields a shape doesn't name pass untouched (token, v, and whatever a newer
// peer adds), an optional field given null is left out, numbers given as
// text are those numbers. A shape refuses only what the old daemon would
// have refused or misread. An answer's shape requires only what its callers
// read, and what every daemon since 0.1 (protocol 2) sends. A wire field is
// never renamed here: a change of meaning is a new field, or a new protocol
// version.
import { shape, type Infer, type ObjectOf, type ObjectShape, type Shape } from "@mileniumhq/paperapi";
import type { PaperCraneEngine } from "../engine";
import type { PanelManifest } from "../types";
import type { BackupService } from "../backups/service";
import type { PortRegistry } from "../ports";
import type { PanelProblems } from "../problems";
import type { ActionsRegistry } from "../actions";
import type { UsageReport } from "../usage";
import type { GpuReport } from "../gpu";
import type { OfferedShell } from "../shellIntegration";
import type { PackageUpdateWait } from "../enginePackages";
import { INPUT_ENCODINGS } from "../supervisorTypes";
import { BACKUP_LABEL_MAX, isDestinationId } from "../backups/types";
import { configPath, envMap, flag, id, InvalidParamsError, list, numeric, object, opt, panelId, readValue, text } from "./params";

/** The longest project picture: a data URL of a 256 KB server icon fits. */
export const MAX_PROJECT_IMAGE = 512 * 1024;
// single-frame write cap: 16 MiB of parsed content is far past any
// legitimate panel state file; larger blobs ride file:download, which
// streams with its own cap instead of living twice in one JSON frame
const FILE_WRITE_MAX = 16 * 1024 * 1024;
// a call to a registry entry waits at most this long; null waits it out
const CALL_TIMEOUT_MAX_MS = 60_000;

/**
 * A value the code it goes to checks itself: a param a service validates
 * (a backup source, a port claim), or a daemon record the caller doesn't
 * look inside. Its type is the daemon's own.
 */
function typed<T>(): Shape<T> {
    return { check: () => null };
}

const anyText = () => text(Infinity, { empty: true });
const success = object({ success: shape.boolean() });
const nothing = object({});
const supervisedId = () => text(128);
const appId = opt(text(128));
const panelFilter = opt(text(128));
const panelManifests = list(typed<PanelManifest>());

// what a registry entry is named: a kind, a dot and the definition's id,
// optionally inside a project ("server1/command.kick-player")
const ENTRY_PATTERN = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/)?(type|command|value|event)\.[a-z0-9][a-z0-9-]{0,63}$/;
const entry = (): Shape<string> => {
    const bounded = text(256);
    return {
        check: (value, at) =>
            bounded.check(value, at, false) ??
            (ENTRY_PATTERN.test(value as string) ? null : `Parameter "${at}" must name a block entry ("kind.id" or "project/kind.id"), got "${value}"`),
    };
};

// A numeric timeout longer than the cap is refused, not clamped silently.
// An explicit null opts the call out of the deadline entirely — long work
// (installing a runtime) reports progress and completion through panel state
// rather than holding a caller's socket open, but callers that must wait may
// do so. The outstanding-call cap, not the timer, is the budget then.
const callTimeout = (): Shape<number | null> => {
    const n = numeric();
    return {
        ...n,
        check: (value, at) =>
            value === null ? null : n.check(value, at, false) ?? (Number(value) > CALL_TIMEOUT_MAX_MS ? `Parameter "${at}" exceeds ${CALL_TIMEOUT_MAX_MS} ms cap`: null),
        read: (value: unknown) => (value === null ? null : Number(value)),
    } as Shape<number | null>;
};

const destinationId = (): Shape<string> => ({
    check: (value, at) => (isDestinationId(value) ? null : `Invalid ${at}: ${JSON.stringify(value)}`),
});

// a call that names its panel's backups: the panel, and which of its sources
const backupOf = {
    panelId: panelId(),
    // a source is named or left out; null names none of its sources
    sourceId: shape.optional(text(64)),
};
// a call made from inside an action or a block names it, so its answer survives a stopped service
const duringCall = opt(text(64));

const systemFacts = {
    hostname: text(),
    os: text(),
    arch: text(),
    osVersion: opt(text()),
    distroId: opt(text()),
    distroName: opt(text()),
};
const pairingStatus = object({
    active: shape.boolean(),
    computers: list(object({ name: opt(anyText()), pairedAt: anyText() })),
});

type Out<F extends (...args: any) => any> = Awaited<ReturnType<F>>;
type Engine = PaperCraneEngine;
type Backups = BackupService;

// registry actions answer under both the current and the 0.1 spelling
const actionRegister = { params: object({ panelId: panelId(), action: opt(text(256)), actions: opt(list(text(256))), schema: shape.optional(shape.json()) }), result: success };
const actionUnregister = { params: object({ panelId: panelId(), action: opt(text(256)) }), result: success };
const actionCall = {
    params: object({ panelId: panelId(), action: text(256), args: shape.optional(shape.json()), timeoutMs: shape.optional(callTimeout()) }),
    result: object({ result: shape.json() }),
};
const actionList = { params: object({ panelId: panelFilter }), result: object({ actions: typed<ReturnType<ActionsRegistry["list"]>>() }) };
const actionEmit = { params: object({ panelId: panelId(), event: text(256), payload: shape.optional(shape.json()) }), result: success };
const triggerEmit = { params: object({ panelId: panelId(), trigger: text(256), output: shape.optional(shape.json()) }), result: success };

export interface RpcDefinition {
    readonly params: ObjectShape;
    readonly result: Shape<any>;
    /** host authority only: a panel's scoped credential is refused before its params are read */
    readonly host?: true;
}

export const RPC = {
    // auth: wsAuth.ts answers these, and checks authority, before any other action
    "auth:pair": {
        params: object({ code: shape.optional(shape.json()), clientName: shape.optional(shape.json()) }),
        result: object({ success: shape.boolean(), token: text(), ...systemFacts }),
    },
    "auth:verify": { params: object({ token: shape.optional(shape.json()) }), result: object({ success: shape.boolean() }) },
    "auth:scope": { params: object({ panelId: panelId() }), result: success },
    // relayTo names the computer that serves the panel; "local" is this one
    "auth:panel-token": { params: object({ panelId: panelId(), relayTo: shape.optional(text(128)) }), result: object({ token: text() }) },
    "auth:revoke-self": { params: nothing, result: object({ revoked: shape.boolean() }) },

    // terminals
    "term:create": {
        params: object({ id: supervisedId(), cols: opt(numeric()), rows: opt(numeric()), env: opt(envMap()), cwd: opt(text(1024)), shell: opt(text(1024)) }),
        result: success,
    },
    "term:write": { params: object({ id: supervisedId(), data: text(65536, { empty: true }) }), result: success },
    "term:resize": { params: object({ id: supervisedId(), cols: numeric(), rows: numeric() }), result: success },
    "term:attach": { params: object({ id: supervisedId() }), result: success },
    "term:shells": { params: nothing, result: object({ shells: typed<OfferedShell[]>() }) },
    "term:exists": { params: object({ id: supervisedId() }), result: object({ running: shape.boolean() }) },
    "term:destroy": { params: object({ id: supervisedId() }), result: success },

    // processes
    "process:run": {
        params: object({
            id: supervisedId(),
            command: text(),
            // refuse, don't coerce: a non-string arg is a caller bug, and
            // silently dropping it would run a different command than asked
            args: opt(list(anyText())),
            cwd: opt(text(1024)),
            env: opt(envMap()),
            stdin: shape.optional(shape.boolean()),
            inputEncoding: shape.optional(shape.oneOf(...INPUT_ENCODINGS)),
            consoleInput: shape.optional(shape.boolean()),
            important: shape.optional(shape.boolean()),
        }),
        result: success,
    },
    "process:write": { params: object({ id: supervisedId(), data: text(65536, { empty: true }) }), result: success },
    "process:close-input": { params: object({ id: supervisedId() }), result: success },
    "process:kill": { params: object({ id: supervisedId(), signal: opt(text(32)) }), result: success },
    "process:exists": { params: object({ id: supervisedId() }), result: object({ running: shape.boolean() }) },
    "process:attach": { params: object({ id: supervisedId() }), result: success },

    // a panel's files; an empty targetPath is the panel's root, where a path names nothing else
    "file:getPath": { params: object({ targetPath: text(1024, { empty: true }), appId }), result: object({ path: text(Infinity) }) },
    "file:exists": { params: object({ targetPath: text(1024, { empty: true }), appId }), result: object({ exists: shape.boolean() }) },
    "file:write": { params: object({ targetPath: text(1024), content: text(FILE_WRITE_MAX, { empty: true }), appId }), result: object({ path: text(Infinity) }) },
    "file:read": { params: object({ targetPath: text(1024), appId }), result: object({ content: typed<Out<Engine["readFile"]>>() }) },
    "file:delete": { params: object({ targetPath: text(1024), appId }), result: success },
    "file:clear": { params: object({ appId }), result: success },
    "file:download": {
        params: object({
            downloadId: text(128),
            url: text(8192),
            targetPath: text(1024),
            appId,
            options: opt(object({ sha1: opt(anyText()), sha256: opt(anyText()), checksum: opt(object({ algorithm: anyText(), value: anyText() })) })),
        }),
        result: object({ path: text(Infinity) }),
    },

    // runtime packages
    "package:isInstalled": { params: object({ packageName: text(128), version: opt(text(64)) }), result: object({ installed: shape.boolean() }) },
    "package:getIndex": { params: nothing, result: object({ index: shape.record(typed<{ name?: string; version?: string; installedAt?: string }>()) }) },
    "package:getPath": { params: object({ packageName: text(128) }), result: object({ path: typed<string>() }) },
    "package:download": {
        // plan-carrying callers (the updater) give the checksum they expect;
        // a call without one has the daemon look it up in the registry
        params: object({ packageName: text(128), downloadId: text(128), sha256: opt(text(128)), allowDowngrade: flag() }),
        // waiting: verified and staged, installed once the workloads
        // running from the current release stop. Accepted, not completed.
        result: object({ path: text(Infinity), waiting: shape.optional(typed<PackageUpdateWait>()) }),
    },
    "package:pending": { params: nothing, result: object({ updates: list(typed<PackageUpdateWait>()) }) },

    // panels
    "panel:list": { params: nothing, result: object({ panels: panelManifests, invalid: shape.optional(typed<Out<Engine["listPanels"]>["invalid"]>()) }) },
    "service:count": {
        params: nothing,
        result: object({ running: { check: (v, at) => (Number.isSafeInteger(v) && (v as number) >= 0 ? null : `"${at}" must be a count, got ${JSON.stringify(v)}`) } as Shape<number> }),
        host: true,
    },
    "panel:install": {
        // version/sha256 are what the caller expects the registry's release
        // to be, and a disagreement refuses; ifUnused (the updater) holds a
        // panel whose processes people rely on instead of stopping them
        params: object({ panelId: panelId(), version: opt(text(64)), sha256: opt(text(128)), downloadId: opt(text(128)), allowDowngrade: flag(), ifUnused: flag() }),
        result: object({ panel: shape.optional(typed<PanelManifest>()), held: shape.optional(object({ processes: list(anyText()) })) }),
        host: true,
    },
    "update:inUse": {
        params: object({
            panels: opt(list(object({ id: panelId(), version: opt(text(64)), sha256: opt(text(128)) }))),
            packages: opt(list(id())),
            downloadId: opt(text(128)),
        }),
        result: object({ panels: panelManifests, failures: shape.record(anyText()) }),
        host: true,
    },
    // deleting data is opt-in: only an explicit true deletes it
    "panel:uninstall": { params: object({ panelId: panelId(), deleteData: flag() }), result: typed<{ success: boolean } & Out<Engine["uninstallPanel"]>>() },
    "panel:restartService": { params: object({ panelId: panelId() }), result: object({ restarted: typed<Out<Engine["restartPanelService"]>>() }) },
    // config ids are panel-scoped; an explicit path is a JSON file in the panel's own files
    "config:get": { params: object({ id: id(), path: opt(configPath()) }), result: object({ data: shape.json() }) },
    "config:set": { params: object({ id: id(), path: opt(configPath()), data: shape.optional(shape.json()) }), result: success },

    // this computer
    "system:ip": { params: nothing, result: object({ ip: typed<string | null>() }) },
    "system:info": {
        params: nothing,
        result: object({ service: opt(text()), version: opt(text()), ip: opt(text()), username: opt(anyText()), ...systemFacts }),
    },
    "system:gpus": { params: nothing, result: typed<GpuReport>() },
    "system:usage": { params: nothing, result: typed<UsageReport>() },
    "system:pairing-start": { params: nothing, result: object({ code: text() }) },
    "system:pairing-status": { params: nothing, result: pairingStatus },
    "system:pairing-cancel": { params: nothing, result: object({ cancelled: shape.boolean() }) },
    // the handler refuses each missing fact with its reason, before anything
    // is downloaded. A 0.1 daemon answers { success, message } and updates
    // at once, so nothing else in the answer is required.
    "system:update": {
        params: object({ downloadUrl: opt(anyText()), sha256: opt(anyText()), version: opt(anyText()), signature: opt(anyText()) }),
        result: object({ accepted: shape.optional(shape.boolean()), status: opt(anyText()), restartRequired: shape.optional(shape.boolean()), message: opt(anyText()) }),
    },

    // the vault: every call names its panel. get and delete answer "not
    // found" for a name the vault could never hold, so theirs is not checked here
    "secrets:set": { params: object({ panelId: panelId(), name: anyText(), value: anyText() }), result: success },
    "secrets:get": { params: object({ panelId: panelId(), name: shape.optional(shape.json()) }), result: object({ found: shape.boolean(), value: shape.nullable(anyText()) }) },
    "secrets:delete": { params: object({ panelId: panelId(), name: shape.optional(shape.json()) }), result: object({ deleted: shape.boolean() }) },
    "secrets:list": { params: object({ panelId: panelId() }), result: object({ keys: list(anyText()) }) },
    "secrets:purge": { params: object({ panelId: panelId() }), result: object({ purged: numeric() }) },

    // backups: locations are the user's, chosen in the shell; backups are panel-scoped
    "backup:source-define": { params: object({ panelId: panelId(), source: typed<Parameters<Backups["sources"]["define"]>[1]>() }), result: success },
    "backup:destinations": { params: nothing, result: object({ destinations: typed<Out<Backups["listDestinations"]>>() }), host: true },
    "backup:destinations-problem": { params: nothing, result: object({ problem: typed<string | null>() }), host: true },
    "backup:destinations-recover": { params: nothing, result: typed<Out<Backups["recoverLocations"]>>(), host: true },
    "backup:destination-usage": { params: object({ destinationId: destinationId() }), result: typed<Out<Backups["destinationUsage"]>>(), host: true },
    "backup:destination-add": { params: object({ destination: typed<Parameters<Backups["addDestination"]>[0]>() }), result: typed<Out<Backups["addDestination"]>>(), host: true },
    // a Google Drive location signed in again: its new credentials, which the service bounds
    "backup:destination-reconnect": {
        params: object({ destinationId: destinationId(), clientId: anyText(), clientSecret: anyText(), refreshToken: anyText() }),
        result: typed<Out<Backups["reconnectDestination"]>>(),
        host: true,
    },
    "backup:destination-remove": { params: object({ destinationId: destinationId() }), result: success, host: true },
    // null puts the panel back on the computer's own folder
    "backup:panel-destination-set": { params: object({ ...backupOf, destinationId: shape.nullable(destinationId()) }), result: typed<Out<Backups["status"]>>(), host: true },
    "backup:status": { params: object(backupOf), result: typed<Out<Backups["status"]>>() },
    "backup:progress": { params: object({ panelId: panelId() }), result: object({ progress: typed<Out<Backups["progressFor"]>>() }) },
    "backup:create": { params: object({ ...backupOf, label: opt(text(BACKUP_LABEL_MAX)), duringCall }), result: typed<Out<Backups["create"]>>() },
    "backup:list": { params: object(backupOf), result: object({ backups: typed<Out<Backups["list"]>>() }) },
    "backup:restore": { params: object({ ...backupOf, backupId: text(64), duringCall }), result: typed<Out<Backups["restore"]>>() },
    // only an explicit null removes the routine: a call that leaves it out is refused, never read as a delete
    "backup:schedule-set": { params: object({ ...backupOf, schedule: typed<unknown>() }), result: typed<Out<Backups["status"]>>() },
    "backup:delete": { params: object({ ...backupOf, backupId: text(64) }), result: success },

    // ports: claims are panel-scoped; the policy and every claim are the user's
    "ports:claim": {
        params: object({ panelId: panelId(), name: typed<unknown>(), label: typed<unknown>(), protocol: typed<unknown>(), preferred: typed<unknown>() }),
        result: typed<Out<PortRegistry["claim"]>>(),
    },
    "ports:prepare": { params: object({ panelId: panelId(), name: shape.optional(typed<unknown>()) }), result: typed<Out<PortRegistry["prepare"]>>() },
    "ports:release": { params: object({ panelId: panelId(), name: shape.optional(typed<unknown>()) }), result: success },
    "ports:list": { params: object({ panelId: panelId() }), result: object({ claims: typed<Out<PortRegistry["list"]>>() }) },
    "ports:all": { params: nothing, result: object({ claims: typed<Out<PortRegistry["all"]>>(), policy: typed<Out<PortRegistry["policy"]>>() }), host: true },
    "ports:policy-set": { params: object({ policy: shape.optional(typed<unknown>()) }), result: object({ policy: typed<Out<PortRegistry["setPolicy"]>>() }), host: true },

    // problems: a panel reports and clears its own; the shell reads every panel's
    "problems:report": {
        params: object({ panelId: panelId(), key: shape.optional(typed<unknown>()), title: shape.optional(typed<unknown>()), message: shape.optional(typed<unknown>()) }),
        result: success,
    },
    "problems:clear": { params: object({ panelId: panelId(), key: shape.optional(typed<unknown>()) }), result: success },
    "problems:list": { params: object({ panelId: panelId() }), result: object({ problems: typed<Out<PanelProblems["list"]>>() }) },
    "problems:every": { params: nothing, result: object({ panels: typed<Out<PanelProblems["every"]>>() }), host: true },

    // Blocks: panels register types, commands, values and events, each named "kind.id"
    "blocks:register": {
        params: object({ panelId: panelId(), entry: entry(), schema: { check: (v, at) => (v && typeof v === "object" ? null : `blocks:register requires a "${at}" object`) } as Shape<Record<string, unknown>> }),
        result: success,
    },
    "blocks:unregister": { params: object({ panelId: panelId(), entry: entry() }), result: success },
    "blocks:project-define": {
        params: object({ panelId: panelId(), project: text(64), name: text(128), icon: opt(text(128)), image: opt(text(MAX_PROJECT_IMAGE)) }),
        result: success,
    },
    "blocks:project-remove": { params: object({ panelId: panelId(), project: text(64) }), result: success },
    "blocks:projects": { params: object({ panelId: panelFilter }), result: object({ projects: typed<ReturnType<ActionsRegistry["listProjects"]>>() }) },
    "blocks:list": {
        params: object({ panelId: panelFilter }),
        result: object({ entries: list(typed<{ panelId: string; entry: string; project?: string; schema: unknown }>()) }),
    },
    "blocks:call": {
        params: object({ panelId: panelId(), entry: entry(), request: shape.optional(shape.json()), timeoutMs: shape.optional(callTimeout()) }),
        result: object({ result: shape.json() }),
    },
    // an event firing, or a value saying it changed
    "blocks:emit": { params: object({ panelId: panelId(), entry: entry(), payload: shape.optional(shape.json()) }), result: success },

    // the Actions registry (Blocks' predecessor)
    "actions:register": actionRegister,
    "action:register": actionRegister,
    "actions:unregister": actionUnregister,
    "action:unregister": actionUnregister,
    "actions:project-define": { params: object({ panelId: panelId(), project: text(64), name: text(128), icon: opt(text(128)) }), result: success },
    "actions:project-remove": { params: object({ panelId: panelId(), project: text(64) }), result: success },
    "actions:projects": { params: object({ panelId: panelFilter }), result: object({ projects: typed<ReturnType<ActionsRegistry["listProjects"]>>() }) },
    "actions:call": actionCall,
    "action:call": actionCall,
    "actions:list": actionList,
    "action:list": actionList,
    "actions:emit": actionEmit,
    "action:emit": actionEmit,
    "event:emit": actionEmit,
    "triggers:emit": triggerEmit,
    "trigger:emit": triggerEmit,
} as const satisfies Record<string, RpcDefinition>;

export type RpcAction = keyof typeof RPC;
/** An action's params, as its handler is given them and its caller sends them. */
export type RpcParams<A extends RpcAction> = (typeof RPC)[A]["params"] extends ObjectShape<infer F> ? ObjectOf<F> : never;
/** What an action answers. */
export type RpcResult<A extends RpcAction> = Infer<(typeof RPC)[A]["result"]>;

export function isRpcAction(action: unknown): action is RpcAction {
    return typeof action === "string" && Object.hasOwn(RPC, action);
}

/**
 * A call's params as its handler is given them, or an InvalidParamsError
 * naming the action and the field. Params that aren't an object read as
 * none, as the daemon always has: an action that needs one is refused for
 * the field it misses.
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

/** What an action answered, checked; an answer that doesn't fit throws, naming the action. */
export function readResult<A extends RpcAction>(action: A, result: unknown): RpcResult<A> {
    try {
        const definition: RpcDefinition = RPC[action];
        return readValue(definition.result, result, "") as RpcResult<A>;
    } catch (err) {
        if (err instanceof InvalidParamsError) throw new Error(`Paperboard Server's answer to ${action} doesn't fit: ${err.message}`);
        throw err;
    }
}
