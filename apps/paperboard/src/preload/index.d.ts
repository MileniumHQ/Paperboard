import type { ShellWire } from "../shared/shellContract";

declare global {
    interface Window {
        /** the preload's bridge to main; absent in browser mode */
        paperboardShell?: ShellWire;
    }
}

export {};
