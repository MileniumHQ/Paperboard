import fs from "node:fs/promises";
import path from "node:path";
import { packages as packageApi } from "../service/api";
import { exists } from "./serviceKit";
import type { WindowsRuntime } from "./windowsRuntime";

type Packages = Pick<typeof packageApi, "isInstalled" | "download" | "getPath">;

/** Makes the runtime loadable by the server whose executable is in serverDir. */
export async function provideWindowsRuntime(runtime: WindowsRuntime, serverDir: string, windir = process.env.SystemRoot, packages: Packages = packageApi): Promise<void> {
    if (!windir) throw new Error(`Could not check for ${runtime.name}: Windows did not say where it is installed (SystemRoot is not set)`);
    let installed = true;
    for (const file of runtime.files) installed &&= await exists(path.join(windir, ...file.split("/")));
    if (installed) return;
    const { id } = runtime.package;
    if (!(await packages.isInstalled(id))) await packages.download(id);
    const bin = path.join(await packages.getPath(id), "bin");
    const files = await fs.readdir(bin);
    if (files.length === 0) throw new Error(`The ${id} package holds no files, so its install is broken`);
    for (const file of files) await fs.copyFile(path.join(bin, file), path.join(serverDir, file));
}
