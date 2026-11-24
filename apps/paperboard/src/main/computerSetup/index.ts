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

const sshDir = () => path.join(os.homedir(), ".ssh");
const localUser = () => os.userInfo().username;

export const computerSetups = new ComputerSetups(() => ({
    openSsh: (options) => openSsh({ ...options, sshDir: sshDir(), localUser: localUser() }),
    defaultUsername: (host) => resolveSshTarget(host, { sshDir: sshDir(), localUser: localUser() }).user,
    craneIndex: async () => {
        // the updater needs Electron, which this module's callers in tests don't have
        const { REGISTRY_URL } = await import("../updater");
        return {
            entries: (await fetchRegistryJson(`${REGISTRY_URL}/paperdl/crane/index.json`, 15_000)) as Record<string, CraneIndexEntry>,
            downloadUrl: (target) => `${REGISTRY_URL}/paperdl/crane/${target}/download`,
        };
    },
    probe: async (host, port) => (await connectionPool.probe(host, port)).reachable,
    pair: async (host, port, code, name, expect) => ({ id: (await connectionPool.pairComputer(host, port, code, name, expect)).id }),
    tempDir: defaultTempDir,
    changed: (state) => pushToShells("computer-setup-changed", state),
}));

/** whether an SSH server answers for host: its banner starts with "SSH-" */
export function sshAnswers(host: string): Promise<boolean> {
    const target = resolveSshTarget(host, { sshDir: sshDir(), localUser: localUser() });
    return new Promise((resolve) => {
        const socket = net.connect({ host: target.hostName, port: target.port });
        const done = (answer: boolean) => {
            socket.destroy();
            resolve(answer);
        };
        socket.setTimeout(3000, () => done(false));
        socket.once("data", (data) => done(data.toString("latin1").startsWith("SSH-")));
        // quiet: a refused or unreachable port is the answer "no SSH"
        socket.once("error", () => done(false));
    });
}
