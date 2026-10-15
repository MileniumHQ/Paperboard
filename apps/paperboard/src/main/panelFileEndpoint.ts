// Where a computer's daemon answers for panel file transfers, from the
// paired-computer pool. Kept apart from panelFileTransfer.ts so that module
// can be exercised without constructing the pool.
import connectionPool from "./communication/papercrane/ConnectionPool";
import { PanelFileTransferError } from "../shared/fileTransfer";
import type { DaemonEndpoint } from "./panelFileTransfer";

function isLoopback(host: string): boolean {
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function poolEndpoint(computerId: string): DaemonEndpoint {
    let client: ReturnType<typeof connectionPool.getClient>;
    try {
        client = connectionPool.getClient(computerId);
    } catch (err) {
        throw new PanelFileTransferError("unreachable", (err as Error).message);
    }
    const token = client.getToken();
    if (!token) throw new PanelFileTransferError("unreachable", `Computer ${computerId} is not connected`);
    const host = client.getHost();
    const cert = client.getCert();
    if (!isLoopback(host) && !cert) {
        throw new PanelFileTransferError("unreachable", `${host} has no pinned certificate. Remove this computer and pair it again`);
    }
    return { host, port: client.getPort(), token, ...(isLoopback(host) ? {} : { cert }) };
}
