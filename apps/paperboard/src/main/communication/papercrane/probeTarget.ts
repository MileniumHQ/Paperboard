// What a person typed as a computer's address and port, checked before
// anything is dialed. No I/O and no state: the same answer every time.

export const INVALID_ADDRESS = "That isn't a valid address. Type an IP address or a computer name";
export const INVALID_PORT = "That isn't a valid port. Type a whole number from 1 to 65535";

export function bracketHost(host: string): string {
    return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export interface ProbeRejection {
    reachable: false;
    error: string;
    // the host was bad, so there is no port worth naming
    invalidAddress?: true;
}

// The host is judged on its own, first, so a bad port is never blamed on it
// and a bad host is never reported alongside a port that was not tried.
// The port arrives as typed: a whole number from 1 to 65535, never a default
// quietly standing in for something else.
export function checkProbeTarget(host: string, port: number | string): ProbeRejection | { port: number } {
    if (!URL.canParse(`https://${bracketHost(host)}/`)) {
        return { reachable: false, error: INVALID_ADDRESS, invalidAddress: true };
    }
    const text = String(port).trim();
    const typed = /^\d{1,5}$/.test(text) ? Number(text) : NaN;
    if (!(typed >= 1 && typed <= 65535)) return { reachable: false, error: INVALID_PORT };
    return { port: typed };
}
