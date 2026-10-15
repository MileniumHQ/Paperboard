// Test hosts differ in which extra local addresses exist: Linux routes all of
// 127/8 to lo, macOS answers only 127.0.0.1 unless an alias is configured.
// Probe by binding instead of guessing from the platform.
import * as net from "net";
import * as os from "os";

export async function canBindLocalAddress(address: string): Promise<boolean> {
    const probe = net.createServer();
    try {
        await new Promise<void>((resolve, reject) => {
            probe.once("error", reject);
            probe.listen(0, address, () => resolve());
        });
        return true;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EADDRNOTAVAIL" || code === "EINVAL") return false;
        throw error;
    } finally {
        if (probe.listening) await new Promise<void>((resolve) => probe.close(() => resolve()));
    }
}

/** An address of this machine that a client treats as another computer. */
export async function remoteDialAddress(): Promise<string | null> {
    if (await canBindLocalAddress("127.0.0.2")) return "127.0.0.2";
    for (const entries of Object.values(os.networkInterfaces())) {
        for (const entry of entries ?? []) {
            if (entry.family === "IPv4" && !entry.internal) return entry.address;
        }
    }
    return null;
}
