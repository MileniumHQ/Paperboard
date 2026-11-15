// The one way the shell's calls reach main's handlers: a call's args are
// read against its declared shape (shared/shellContract.ts), and only then
// does its handler run. Electron IPC (shelldata.ts) and browser mode
// (browserHost.ts) serve through it, each after its own caller check, so a
// host serves exactly the channels the contract gives it: one it misses, or
// one it adds, stops it from starting.
import {
    readSendArgs,
    readShellArgs,
    shellChannels,
    type BrowserShellCall,
    type BrowserShellSend,
    type CallAnswer,
    type CallArgs,
    type SendArgs,
    type ShellCall,
    type ShellSend,
} from "../../shared/shellContract";

export type CallHandler<K extends ShellCall, C> = (args: CallArgs<K>, caller: C) => CallAnswer<K> | Promise<CallAnswer<K>>;
export type CallHandlers<K extends ShellCall, C> = { readonly [P in K]: CallHandler<P, C> };
export type SendHandlers<K extends ShellSend> = { readonly [P in K]: (args: SendArgs<P>) => void };

export interface ShellServer<C> {
    readonly calls: readonly ShellCall[];
    readonly sends: readonly ShellSend[];
    /** answers a call the host serves; rejects with why its args were refused */
    call(channel: ShellCall, args: unknown, caller: C): Promise<unknown>;
    /** runs a send the host serves; throws why its args were refused */
    send(channel: ShellSend, args: unknown): void;
}

export function shellServer<C>(host: "window", calls: CallHandlers<ShellCall, C>, sends: SendHandlers<ShellSend>): ShellServer<C>;
export function shellServer<C>(host: "browser", calls: CallHandlers<BrowserShellCall, C>, sends: SendHandlers<BrowserShellSend>): ShellServer<C>;
export function shellServer<C>(
    host: "window" | "browser",
    calls: Partial<Record<ShellCall, CallHandler<any, C>>>,
    sends: Partial<Record<ShellSend, (args: any) => void>>,
): ShellServer<C> {
    const served = shellChannels(host);
    const drift = (kind: string, declared: readonly string[], handled: object) => {
        const missing = declared.filter((channel) => !Object.hasOwn(handled, channel));
        const extra = Object.keys(handled).filter((channel) => !declared.includes(channel));
        if (missing.length || extra.length) {
            throw new Error(
                `The ${host} shell host doesn't serve the ${kind} its contract declares:` +
                    (missing.length ? ` missing ${missing.join(", ")}.` : "") +
                    (extra.length ? ` not declared for it: ${extra.join(", ")}.` : ""),
            );
        }
    };
    drift("calls", served.calls, calls);
    drift("sends", served.sends, sends);
    const unserved = (channel: string) => new Error(`The ${host} shell host doesn't serve ${channel}`);
    return {
        ...served,
        call: async (channel, args, caller) => {
            const handler = calls[channel];
            if (!handler) throw unserved(channel);
            return handler(readShellArgs(channel, args), caller);
        },
        send: (channel, args) => {
            const handler = sends[channel];
            if (!handler) throw unserved(channel);
            handler(readSendArgs(channel, args));
        },
    };
}
