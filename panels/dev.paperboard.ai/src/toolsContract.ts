// What the Tools page and the service agree on: the tool servers the agent
// may use (MCP servers on this computer or inside its own), whether it may
// run other panels' actions, and what each server is doing right now.
//
// The config is a document of its own (tools.json). Secret values never
// appear in it: it names them, and the daemon's vault holds them, under
// `mcp.<server>.<name>` for this panel.

export const TOOLS_ACTION_IDS = {
    get: "ui-tools-get",
    save: "ui-tools-save",
    remove: "ui-tools-remove",
    restart: "ui-tools-restart",
    setActions: "ui-tools-set-actions",
    setSecret: "ui-tools-set-secret",
    deleteSecret: "ui-tools-delete-secret",
} as const;

/** a server's status changed; the payload is the whole ToolsView */
export const TOOLS_EVENT = "tools-changed";

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
export interface SecretRef {
    secret: string;
}

export type ServerValue = string | SecretRef;

export type ServerSpec =
    | {
          name: string;
          where: "host" | "computer";
          transport: "stdio";
          /** argv[0]; never a shell line */
          command: string;
          args: string[];
          env: Record<string, ServerValue>;
          enabled: boolean;
      }
    | {
          name: string;
          /** an HTTP server is reached from this computer */
          where: "host";
          transport: "http";
          url: string;
          headers: Record<string, ServerValue>;
          enabled: boolean;
      };

export interface ToolsConfig {
    /** may the agent find and run other panels' actions */
    actions: boolean;
    servers: ServerSpec[];
}

export const DEFAULT_TOOLS: ToolsConfig = { actions: true, servers: [] };

export type ServerPhase = "stopped" | "starting" | "running" | "failed";

export interface ServerStatus {
    name: string;
    phase: ServerPhase;
    /** why it failed (or why it is stopped: disabled, its computer is off) */
    error: string | null;
    tools: number;
}

export interface ToolsView {
    config: ToolsConfig;
    status: ServerStatus[];
    /** secret names the vault holds for this panel's servers, keyed by server; never values */
    secrets: Record<string, string[]>;
    /** set when tools.json is unreadable: nothing was overwritten, and saving is refused until it is fixed */
    configError: string | null;
}
