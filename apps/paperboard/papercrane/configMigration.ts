import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomicSync } from "./storage";

/** Explicit v1 migration of known documents. Sources are retained; no
 * guessing from sibling filenames and no cleanup during ordinary writes. */
export function migrateConfigurationV1(root: string): void {
    const marker = path.join(root, "local", "config-migration-v1.json");
    if (fs.existsSync(marker)) {
        if (JSON.parse(fs.readFileSync(marker, "utf8")).version !== 1) throw new Error("Invalid configuration migration record");
        return;
    }
    const documents = [
        ["configs/app-settings.json", "local/app-settings.json"],
        ["configs/shell-last-opened.json", "local/shell-last-opened.json"],
        ["files/dev.paperboard.terminal/data.json", "files/dev.paperboard.terminal/tabs.json"],
        ["files/dev.paperboard.actions/data.json", "files/dev.paperboard.actions/canvas.json"],
        ["files/dev.paperboard.gameserver/data.json", "configs/dev.paperboard.gameserver.json"],
        ["files/dev.paperboard.botcreator/data.json", "configs/dev.paperboard.botcreator.json"],
    ];
    const migrated: string[] = [];
    for (const [from, to] of documents) {
        const source = path.join(root, from);
        const target = path.join(root, to);
        if (!fs.existsSync(source) || fs.existsSync(target)) continue;
        if (fs.statSync(source).size > 1024 * 1024) throw new Error(`Configuration migration source is too large: ${from}`);
        const data = JSON.parse(fs.readFileSync(source, "utf8"));
        writeJsonAtomicSync(target, data);
        migrated.push(to);
    }
    writeJsonAtomicSync(marker, { version: 1, migrated });
}
