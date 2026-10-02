// spawn helper for detached supervisors
import { spawn } from "child_process";
import { SupervisedProcessClient, supervisorPresent } from "./supervisor";
import { EmbeddedSupervisor, isEmbeddedHost } from "./embeddedSupervisor";

export interface PreListeners {
    onData?: (data: string) => void;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
    onExit?: (code: number) => void;
}

export async function spawnSupervisedClient(
    id: string,
    supervisorConfig: any,
    clientsMap: Map<string, any>,
    preListeners?: PreListeners,
): Promise<any> {
    const existing = clientsMap.get(id);
    if (existing) {
        if (existing.isConnected()) throw new Error(`Process ${id} is already running`);
        existing.destroy();
        clientsMap.delete(id);
    }

    // embedded host supervises in-process, it cannot spawn itself
    if (isEmbeddedHost()) {
        const embedded = new EmbeddedSupervisor(id, supervisorConfig);
        clientsMap.set(id, embedded);

        if (preListeners?.onData) embedded.on("data", preListeners.onData);
        if (preListeners?.onStdout) embedded.on("stdout", preListeners.onStdout);
        if (preListeners?.onStderr) embedded.on("stderr", preListeners.onStderr);
        if (preListeners?.onExit)
            embedded.on("exit", (code: number) => {
                clientsMap.delete(id);
                preListeners!.onExit!(code);
            });

        if (!await embedded.connect()) {
            clientsMap.delete(id);
            throw new Error(embedded.startError ?? `Process ${id} could not start`);
        }
        return embedded;
    }

    // a supervisor already listening for this id (one that outlived a
    // daemon restart) is a running workload: spawning another would take
    // over its endpoint and orphan it beyond the reach of kill and uninstall
    if (supervisorPresent(id)) {
        const probe = new SupervisedProcessClient(id);
        const live = await probe.connect();
        probe.destroy();
        if (live) throw new Error(`Process ${id} is already running; attach to it instead of starting it again`);
    }

    const execPath = process.execPath;

    const supervisorProc = spawn(execPath, ["--supervise", id], {
        detached: true,
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
    });

    if (supervisorProc.stdin) {
        supervisorProc.stdin.write(JSON.stringify(supervisorConfig));
        supervisorProc.stdin.end();
    }
    supervisorProc.unref();

    const client = new SupervisedProcessClient(id);
    clientsMap.set(id, client);

    // listeners first so initial output is never missed
    if (preListeners?.onData) client.on("data", preListeners.onData);
    if (preListeners?.onStdout) client.on("stdout", preListeners.onStdout);
    if (preListeners?.onStderr) client.on("stderr", preListeners.onStderr);
    if (preListeners?.onExit) client.on("exit", preListeners.onExit);

    for (let i = 0; i < 40; i++) {
        const connected = await client.connect();
        if (connected) break;
        await new Promise((r) => setTimeout(r, 50));
    }

    if (!client.isConnected()) {
        client.destroy(); clientsMap.delete(id);
        throw new Error(`Supervisor ${id} did not become ready`);
    }
    try {
        await client.awaitStarted();
    } catch (err) {
        client.destroy(); clientsMap.delete(id);
        throw err;
    }
    return client;
}
