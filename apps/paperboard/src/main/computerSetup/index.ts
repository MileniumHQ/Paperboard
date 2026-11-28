// The app's one ComputerSetups, wired to this computer: its ~/.ssh, the
// registry's signed releases, and the computers it pairs.
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fetchRegistryJson } from "@mileniumhq/paperapi/config";
import connectionPool from "../communication/papercrane/ConnectionPool";
import { pushToShells } from "../communication/shellPush";
import { ComputerSetups, defaultTempDir, type CraneIndexEntry } from "./setup";
import { openSsh } from "./ssh";
import { resolveSshTarget } from "./sshConfig";
import { bareHost } from "../communication/papercrane/probeTarget";

const sshDir = () => path.join(os.homedir(), ".ssh");
const localUser = () => os.userInfo().username;

export const computerSetups = new ComputerSetups(() => ({
    openSsh: (options) => openSsh({ ...options, host: bareHost(options.host), sshDir: sshDir(), localUser: localUser() }),
    defaultUsername: (host) => resolveSshTarget(bareHost(host), { sshDir: sshDir(), localUser: localUser() }).user,
    craneIndex: async () => {
        // it needs Electron, which the tests that load this module don't have
        const registry = (await import("./registry")).registryUrl();
        return {
            entries: (await fetchRegistryJson(`${registry}/paperdl/crane/index.json`, 15_000)) as Record<string, CraneIndexEntry>,
            downloadUrl: (target) => `${registry}/paperdl/crane/${target}/download`,
        };
    },
    probe: async (host, port) => (await connectionPool.probe(host, port)).reachable,
    pair: async (host, port, code, expect) => ({ id: (await connectionPool.pairComputer(host, port, code, expect)).id }),
    tempDir: defaultTempDir,
    changed: (state) => pushToShells("computer-setup-changed", state),
}));

/** whether an SSH server answers for host: its banner starts with "SSH-" */
export async function sshAnswers(host: string): Promise<boolean> {
    const target = resolveSshTarget(bareHost(host), { sshDir: sshDir(), localUser: localUser() });
    return new Promise((resolve) => {
        const socket = net.connect({ host: target.hostName, port: target.port });
        let settled = false;
        const done = (answer: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(answer);
        };
        socket.setTimeout(3000, () => done(false));
        socket.once("data", (data) => done(data.toString("latin1").startsWith("SSH-")));
        // quiet: a refused or unreachable port is the answer "no SSH"
        socket.once("error", () => done(false));
        // a port that takes the connection and closes it without a word
        socket.once("close", () => done(false));
    });
}
