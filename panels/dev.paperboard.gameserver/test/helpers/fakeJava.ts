// Compiles fakeJava.main.ts into a native executable and installs it as the
// daemon's Java runtime packages (`<PAPERBOARD_DIR>/packages/java-N/bin/java`),
// so the panel's real launch and install paths start it as Java.
import * as fs from "node:fs";
import * as path from "node:path";
import { exe, standIn } from "./standIn";

/** The compiled stand-in, built once per test file. */
export const fakeJavaBinary = (): string => standIn("fakeJava", "java");

/** Installs the stand-in as a Java package of the test daemon; returns the package's home. */
export function installFakeJava(packageId: string, dataDir = process.env.PAPERBOARD_DIR!): string {
    const home = path.join(dataDir, "packages", packageId);
    // installed once: a running server may be executing it
    if (fs.existsSync(path.join(home, "bin", exe("java")))) return home;
    fs.mkdirSync(path.join(home, "bin"), { recursive: true });
    fs.copyFileSync(fakeJavaBinary(), path.join(home, "bin", exe("java")));
    if (process.platform !== "win32") fs.chmodSync(path.join(home, "bin", exe("java")), 0o755);
    return home;
}
