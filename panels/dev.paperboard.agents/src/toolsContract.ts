// What the Tools page and the service agree on: the tool servers the agent
// may use (MCP servers on this computer or inside its own), whether it may
// use other panels' blocks, and what each server is doing right now.
//
// The config is a document of its own (tools.json). Secret values never
// appear in it: it names them, and the daemon's vault holds them, under
// `mcp.<server>.<name>` for this panel. The shapes are the panel's
// contract's (contract.ts), which carries the Tools page's calls.

import { shape, type Infer } from "@mileniumhq/paperapi";

export const TOOL_LIMITS = {
    servers: 16,
    /** servers on at once; the rest are saved but off */
    running: 8,
    name: 24,
    command: 512,
    args: 32,
    arg: 4096,
    env: 32,
    envName: 64,
    envValue: 4096,
    headers: 16,
    headerValue: 4096,
    url: 2048,
    secretName: 64,
    secretValue: 8192,
} as const;

/** a secret the vault holds for a server; the config only ever names it */
const secretRef = shape.object({ secret: shape.text() });
export type SecretRef = Infer<typeof secretRef>;

const serverValue = shape.either(shape.text(), secretRef);
export type ServerValue = Infer<typeof serverValue>;

export const serverSpec = shape.either(
    shape.object({
        name: shape.text(),
        where: shape.oneOf("host"),
        transport: shape.oneOf("stdio"),
        /** argv[0]; never a shell line */
        command: shape.text(),
        args: shape.list(shape.text()),
        env: shape.record(serverValue),
        enabled: shape.boolean(),
    }),
    shape.object({
        name: shape.text(),
        /** an HTTP server is reached from this computer */
        where: shape.oneOf("host"),
        transport: shape.oneOf("http"),
        url: shape.text(),
        headers: shape.record(serverValue),
        /** the server signs the user in (OAuth); its tokens live in the vault under OAUTH_SECRET */
        oauth: shape.boolean(),
        /** the older HTTP+SSE transport: a stream the server answers on, and an address to post to */
        sse: shape.boolean(),
        enabled: shape.boolean(),
    }),
);
export type ServerSpec = Infer<typeof serverSpec>;

/** the vault entry a signed-in server's tokens are kept under */
export const OAUTH_SECRET = "oauth";

const toolsConfig = shape.object({
    /** may the agent find and use other panels' blocks */
    blocks: shape.boolean(),
    servers: shape.list(serverSpec),
});
export type ToolsConfig = Infer<typeof toolsConfig>;

export const DEFAULT_TOOLS: ToolsConfig = { blocks: true, servers: [] };

const serverStatus = shape.object({
    name: shape.text(),
    phase: shape.oneOf("stopped", "starting", "running", "failed"),
    /** the server wants the user to sign in (again) before it can start */
    needsSignIn: shape.boolean(),
    /** why it failed (or why it is stopped: disabled, its computer is off) */
    error: shape.nullable(shape.text()),
    tools: shape.number(),
});
export type ServerStatus = Infer<typeof serverStatus>;

/** A sign-in under way: the page to open, and the loopback address it comes back to. */
const signIn = shape.object({
    url: shape.text(),
    /** where the browser comes back to; on another device the panel catches it there and passes it on */
    callback: shape.text(),
    /** why it stopped, if it did */
    error: shape.nullable(shape.text()),
});
export type SignIn = Infer<typeof signIn>;

export const toolsView = shape.object({
    config: toolsConfig,
    status: shape.list(serverStatus),
    /** secret names the vault holds for this panel's servers, keyed by server; never values */
    secrets: shape.record(shape.list(shape.text())),
    /** set when tools.json is unreadable: nothing was overwritten, and saving is refused until it is fixed */
    configError: shape.nullable(shape.text()),
    /** sign-ins under way, by server */
    signIns: shape.record(signIn),
});
export type ToolsView = Infer<typeof toolsView>;
