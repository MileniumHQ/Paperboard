import { copyFile, readFile, readdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The site's panel screenshots are the panels' own store screenshots. This
// copies each featured panel's dark screenshots, in store order, from
// panels/<id>/store to public/screens/<name>-<n>.png, and removes copies the
// store no longer has. Run it after a panel's store screenshots change:
//   bun run screens
// The marketing pages pick screenshots by these names in
// src/site/learn/panels.ts; the hero and device renders take theirs from
// scripts/renders/shots.mjs.

const PANELS = {
    "dev.paperboard.gameserver": "gameserver",
    "dev.paperboard.botcreator": "botcreator",
    "dev.paperboard.actions": "actions",
    "dev.paperboard.agents": "agents",
};

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const panels = resolve(site, "..", "..", "panels");
const screens = join(site, "public", "screens");

for (const [id, name] of Object.entries(PANELS)) {
    const dir = join(panels, id);
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    const shots = manifest.store?.screenshots;
    if (!shots?.length) throw new Error(`screens: ${id} has no store screenshots`);
    const written = new Set();
    for (const [index, shot] of shots.entries()) {
        if (!shot.dark) throw new Error(`screens: ${id} screenshot ${index + 1} has no dark image`);
        const file = `${name}-${index + 1}.png`;
        await copyFile(join(dir, shot.dark), join(screens, file));
        written.add(file);
    }
    const stale = (await readdir(screens)).filter((file) => new RegExp(`^${name}-\\d+\\.png$`).test(file) && !written.has(file));
    for (const file of stale) await unlink(join(screens, file));
    console.log(`screens: ${id} -> ${[...written].join(", ")}${stale.length ? ` (removed ${stale.join(", ")})` : ""}`);
}
