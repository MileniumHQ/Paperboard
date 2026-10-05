import { mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";

// node-pty sidecar for the standalone Windows crane, written to
// <craneDir>/node-pty. The compiled binary bundles node-pty's JS but cannot
// load conpty.node from inside the bundle, so papercrane/pty.ts requires this
// copy by absolute path; without it no terminal can start. Every Windows
// crane distribution (USB bundle and release zip) ships it.
export function writeNodePtySidecar(craneDir: string, sidecarSrc: string): void {
    const sidecarDest = join(craneDir, "node-pty");
    mkdirSync(join(sidecarDest, "lib"), { recursive: true });
    mkdirSync(join(sidecarDest, "prebuilds", "win32-x64"), { recursive: true });
    cpSync(join(sidecarSrc, "lib"), join(sidecarDest, "lib"), { recursive: true });
    // Sidecar patch: Bun's net.Socket({fd}) silently drops writes to
    // conpty input pipes; plain fs writes deliver. Scoped to this copy
    // (standalone crane only — Electron resolves its own node-pty).
    {
        const agentJs = join(sidecarDest, "lib", "windowsPtyAgent.js");
        const src = readFileSync(agentJs, "utf8");
        const from = `        var inSocketFD = fs.openSync(term.conin, 'w');
        this._inSocket = new net_1.Socket({
            fd: inSocketFD,
            readable: false,
            writable: true
        });
        this._inSocket.setEncoding('utf8');`;
        const to = `        var inSocketFD = fs.openSync(term.conin, 'w');
    // Paperboard sidecar patch: Bun's net.Socket({fd}) silently drops
    // writes to conpty input pipes (or throws ERR_SOCKET_CLOSED), while
    // plain fs writes deliver. This copy ships ONLY with the standalone
    // crane (always the Bun runtime); Electron resolves its own
    // node-pty and never loads this file.
    var inSocketShim = {
        _fd: inSocketFD,
        readable: false,
        writable: true,
        setEncoding: function () {},
        destroy: function () { try { fs.closeSync(inSocketFD); } catch (e) { console.debug("shim socket already closed:", String(e)); } },
        on: function () { return this; },
        once: function () { return this; },
        removeListener: function () { return this; },
        write: function (data, a, b) {
            try {
                var buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
                fs.writeSync(inSocketFD, buf, 0, buf.length);
                if (typeof a === "function") a();
                return true;
            } catch (e) {
                if (typeof console !== "undefined" && console.debug) console.debug("shim socket write failed");
                if (typeof a === "function") a(e);
                return false;
            }
        }
    };
    this._inSocket = inSocketShim;`;
        if (!src.includes(from)) {
            throw new Error("node-pty sidecar patch no longer applies. Update it for the new node-pty version");
        }
        writeFileSync(agentJs, src.replace(from, to));
    }
    cpSync(
        join(sidecarSrc, "prebuilds", "win32-x64"),
        join(sidecarDest, "prebuilds", "win32-x64"),
        { recursive: true },
    );
    // Debug symbols are dead weight at runtime (~25MB).
    for (const dead of readdirSync(join(sidecarDest, "prebuilds", "win32-x64"), { recursive: true }) as string[]) {
        if (dead.endsWith(".pdb") || dead.endsWith(".map")) {
            unlinkSync(join(sidecarDest, "prebuilds", "win32-x64", dead));
        }
    }
}
