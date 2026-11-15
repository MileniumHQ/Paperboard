// The system libraries a Source server needs on Linux, as ldd reports them:
// the install's own, then Origami's packages for what the computer lacks.
import fs from "node:fs/promises";
import path from "node:path";
import { packages as packageApi } from "../../service/api";
import type { Server } from "../../service/server";
import type { SourceGameSpec } from "./index";

function linuxBinary(spec: SourceGameSpec) {
    const binary = spec.binaries.linux;
    if (!binary) throw new Error(`${spec.name} has no Linux server`);
    return binary;
}
/** System libraries the server needs that these folders and the computer lack. */
async function missingLibraries(server: Server, spec: SourceGameSpec, install: string, folders: readonly string[]): Promise<string[]> {
    const binary = linuxBinary(spec);
    const libraries = path.join(install, binary.libraryDir);
    const targets = [path.join(install, binary.executable), ...(await fs.readdir(libraries)).filter((f) => f.endsWith(".so")).map((f) => path.join(libraries, f))];
    let output = "";
    const result = await server.process.run({ command: "ldd", args: targets, env: { LD_LIBRARY_PATH: folders.join(":") }, onStdout: (data) => { output += data; } });
    if (result.exitCode !== 0 && !output) throw new Error(`Could not check ${spec.name}'s libraries: ldd exited with ${result.exitCode}`);
    const missing = new Set<string>();
    for (const line of output.split("\n")) {
        const name = /^\s*(\S+) => not found/.exec(line)?.[1];
        if (name && !name.endsWith("_srv.so")) missing.add(name);
    }
    return [...missing].sort();
}
function checked(spec: SourceGameSpec, missing: string[], folders: string[]): string[] {
    if (missing.length > 0) throw new Error(`${spec.name}'s server needs ${missing.join(", ")}, which this computer doesn't have. Install ${missing.length === 1 ? "it" : "them"} with your system's package manager, then start again.`);
    return folders;
}
/** The folders the server loads libraries from: its own, then Origami's for what the computer lacks. */
export async function libraryPath(server: Server, spec: SourceGameSpec, install: string): Promise<string[]> {
    const folders = [path.join(install, linuxBinary(spec).libraryDir)];
    const missing = await missingLibraries(server, spec, install, folders);
    const supplied = missing.filter((name) => spec.libraryPackages?.[name]);
    if (supplied.length === 0) return checked(spec, missing, folders);
    for (const name of supplied) {
        const { id } = spec.libraryPackages![name]!;
        if (!(await packageApi.isInstalled(id))) await packageApi.download(id);
        folders.push(path.join(await packageApi.getPath(id), "bin"));
    }
    return checked(spec, await missingLibraries(server, spec, install, folders), folders);
}
