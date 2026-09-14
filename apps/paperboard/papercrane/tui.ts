import * as readline from "readline";
import { PaperCraneAuth, type AuthorizedToken } from "./auth";
import { readBanner } from "./branding";

export interface TuiOptions {
    host: string;
    port: number;
    auth: PaperCraneAuth;
    onStop: () => void;
}

export class PaperCraneTui {
    private host: string;
    private port: number;
    private auth: PaperCraneAuth;
    private onStop: () => void;
    private isPromptingRevoke = false;

    constructor(options: TuiOptions) {
        this.host = options.host;
        this.port = options.port;
        this.auth = options.auth;
        this.onStop = options.onStop;

        this.auth.on("paired", (client: AuthorizedToken) => {
            this.render();
            if (client.clientName && client.clientName !== "host") {
                console.log(`\n  [✓] Successfully paired with: ${client.clientName}\n`);
            }
        });

        this.auth.on("revoked", (client: AuthorizedToken) => {
            this.render();
            if (client.clientName && client.clientName !== "host") {
                console.log(`\n  [x] Revoked access for: ${client.clientName}\n`);
            }
        });
    }

    // "host" token is infrastructure, hidden from every list
    private visibleClients(): AuthorizedToken[] {
        return this.auth
            .getAuthorizedClients()
            .filter((c) => c.clientName !== "host");
    }

    public start() {
        if (!process.stdin.isTTY) {
            this.renderPlain();
            return;
        }

        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.setRawMode) {
            process.stdin.setRawMode(true);
        }
        process.stdin.resume();

        process.stdin.on("keypress", (str, key) => {
            if (!key) return;

            if (key.ctrl && key.name === "c") {
                this.stop();
                return;
            }

            if (this.isPromptingRevoke) {
                const num = parseInt(str, 10);
                const clients = this.visibleClients();
                if (!isNaN(num) && num >= 1 && num <= clients.length) {
                    const toRevoke = clients[num - 1];
                    this.auth.revokeToken(toRevoke.token);
                }
                this.isPromptingRevoke = false;
                this.render();
                return;
            }

            if (this.auth.isPairingActive()) {
                if (key.name === "c") {
                    this.auth.cancelPairing();
                    this.render();
                } else if (key.name === "s" || key.name === "q") {
                    this.stop();
                }
            } else {
                if (key.name === "p") {
                    this.auth.startPairing();
                    this.render();
                } else if (key.name === "r") {
                    const clients = this.visibleClients();
                    if (clients.length === 0) {
                        this.render();
                        console.log("\n  No paired computers to revoke.");
                    } else if (clients.length === 1) {
                        this.auth.revokeToken(clients[0].token);
                        this.render();
                    } else {
                        this.isPromptingRevoke = true;
                        process.stdout.write(`\n  Type the number of the computer to revoke (1-${clients.length}): `);
                    }
                } else if (key.name === "s" || key.name === "q") {
                    this.stop();
                }
            }
        });

        this.render();
    }

    private clear() {
        process.stdout.write("\x1Bc");
    }

    public render() {
        if (!process.stdin.isTTY) {
            this.renderPlain();
            return;
        }

        this.clear();
        console.log(readBanner() ?? "Paperboard Server");
        console.log(`Listening on http://${this.host}:${this.port}\n`);
        console.log("Only pair on a home or other trusted network you control: the connection is unencrypted on the local network.\n");

        if (this.auth.isPairingActive()) {
            const code = this.auth.getPairingCode() || "------";
            const formattedCode = `${code.slice(0, 3)} ${code.slice(3)}`;
            console.log(`Pairing Code: ${formattedCode}\n`);
            console.log("[c] Cancel pairing    [s] Stop server");
        } else {
            const clients = this.visibleClients();
            console.log(`Paired Computers (${clients.length}):`);
            if (clients.length === 0) {
                console.log("  (None)");
            } else {
                clients.forEach((c, idx) => {
                    const date = c.pairedAt ? new Date(c.pairedAt).toLocaleDateString() : "";
                    console.log(`  ${idx + 1}. ${c.clientName || "Unknown Computer"} ${date ? `(paired ${date})` : ""}`);
                });
            }
            console.log("\n[p] Pair new computer    [r] Revoke computer    [s] Stop server");
        }
    }

    private renderPlain() {
        console.log(`[Paperboard Server] Listening on http://${this.host}:${this.port}`);
        console.log("[Paperboard Server] Only pair on a trusted network you control: the connection is unencrypted on the local network.");
        if (this.auth.isPairingActive()) {
            const code = this.auth.getPairingCode() || "------";
            console.log(`[Paperboard Server] Pairing Code: ${code.slice(0, 3)} ${code.slice(3)}`);
        }
    }

    public stop() {
        if (process.stdin.setRawMode) {
            process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        this.onStop();
    }
}
