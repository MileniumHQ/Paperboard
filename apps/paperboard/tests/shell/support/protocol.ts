import type { AppUpdateState } from "../../../src/shared/appUpdate";
import type { UpdateQueueState } from "../../../src/shared/updateQueue";

// the shell host (host.main.ts) starts each answer line with this; the
// daemon client it runs logs to stdout too
export const ANSWER = "@@shell-host ";

/** the commands the host runs, each with what it answers; shell.host() takes only these */
export interface HostCommands {
    "sign-in-url": { command: { cmd: "sign-in-url" }; result: string };
    "push-update-queue": { command: { cmd: "push-update-queue"; state: UpdateQueueState }; result: true };
    "push-app-update": { command: { cmd: "push-app-update"; state: AppUpdateState }; result: true };
    /** resolves with how many Google sign-ins opened a browser, once at least `atLeast` have */
    "google-sign-ins": { command: { cmd: "google-sign-ins"; atLeast: number }; result: number };
}

export type Command = HostCommands[keyof HostCommands]["command"];
export type CommandResult<C extends Command> = HostCommands[C["cmd"]]["result"];
