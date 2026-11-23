// A drive on a throwaway folder of its own, opened as the service opens it.
import { onTestFinished } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Drive } from "../../src/lib/drive";

export interface TestDrive {
    drive: Drive;
    /** the drive's folder on disk */
    root: string;
    /** where uploads wait until they're whole */
    temp: string;
    /** a folder beside the drive, outside it */
    outside: string;
    /** writes a file in the drive, making its folders */
    put(rel: string, content?: string | Buffer): string;
}

export async function openDrive(): Promise<TestDrive> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drive-test-"));
    const root = path.join(dir, "Drive");
    const temp = path.join(dir, ".uploads");
    const outside = path.join(dir, "outside");
    fs.mkdirSync(outside);
    const drive = new Drive(root, temp);
    await drive.open();
    // a hook registered here at the top would run for the first test file only
    onTestFinished(async () => {
        await drive.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    return {
        drive,
        root,
        temp,
        outside,
        put(rel, content = "") {
            const full = path.join(root, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, content);
            return full;
        },
    };
}
