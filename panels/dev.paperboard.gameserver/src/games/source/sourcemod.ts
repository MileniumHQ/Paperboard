import fs from "node:fs/promises";
import path from "node:path";

// SourceMod on a Source server: Metamod:Source loads it, and it loads the
// plugins (.smx) in addons/sourcemod/plugins. Paperboard keeps addons/ and
// cfg/sourcemod/ in the server folder, where backups carry them and updates
// of the game leave them alone, and links them into the game's folder while
// SourceMod is on. SourceMod's own convention is followed: a plugin in
// plugins/disabled/ is installed but not loaded.

/** The plugins SourceMod ships, as its documentation describes them. */
export const BUNDLED_PLUGINS: Readonly<Record<string, { title: string; description: string }>> = {
    "admin-flatfile": { title: "Admin File Reader", description: "Reads admins from configs/admins_simple.ini and admins.cfg. Admins made on Players are kept there." },
    adminhelp: { title: "Admin Help", description: "Lists the admin commands a player may use, with sm_help." },
    adminmenu: { title: "Admin Menu", description: "The in-game admin menu, opened with sm_admin." },
    antiflood: { title: "Anti-Flood", description: "Stops players from spamming chat." },
    basebans: { title: "Basic Ban Commands", description: "sm_ban, sm_unban and sm_addban for admins." },
    basechat: { title: "Basic Chat", description: "Admin chat and server-wide messages: sm_say, sm_csay, sm_psay." },
    basecomm: { title: "Basic Comm Control", description: "Mutes and gags players: sm_mute, sm_gag, sm_silence." },
    basecommands: { title: "Basic Commands", description: "sm_kick, sm_map, sm_rcon, sm_cvar and other core admin commands." },
    basetriggers: { title: "Basic Info Triggers", description: "Answers chat words like timeleft, nextmap and ff." },
    basevotes: { title: "Basic Votes", description: "Admin votes on maps, kicks and bans." },
    clientprefs: { title: "Client Preferences", description: "Lets plugins remember each player's settings." },
    funcommands: { title: "Fun Commands", description: "Admin commands such as sm_slap, sm_burn and sm_beacon." },
    funvotes: { title: "Fun Votes", description: "Admin votes for gravity, burning and other fun." },
    nextmap: { title: "Nextmap", description: "Shows and sets the next map: sm_nextmap." },
    playercommands: { title: "Player Commands", description: "sm_slay and sm_rename for admins." },
    reservedslots: { title: "Reserved Slots", description: "Keeps slots free for admins on a full server." },
    sounds: { title: "Sound Commands", description: "sm_play for admins." },
    mapchooser: { title: "Map Chooser", description: "Holds a vote for the next map near the end of the current one." },
    nominations: { title: "Map Nominations", description: "Lets players nominate maps for the map vote. Needs Map Chooser." },
    randomcycle: { title: "Random Cycle", description: "Picks the next map at random from the map cycle." },
    rockthevote: { title: "Rock the Vote", description: "Players type rtv to start a vote to change the map. Needs Map Chooser." },
    "admin-sql-prefetch": { title: "Admin SQL Prefetch", description: "Reads admins from a database when the map starts." },
    "admin-sql-threaded": { title: "Admin SQL Threaded", description: "Reads admins from a database as they join." },
    "sql-admin-manager": { title: "SQL Admin Manager", description: "Admin commands for a database of admins." },
};

export interface SourcePlugin {
    /** the file name, "rockthevote.smx" */
    file: string;
    title: string;
    description: string;
    enabled: boolean;
    /** shipped with SourceMod, so it can be turned off but not removed */
    bundled: boolean;
}

const PLUGIN_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\.smx$/;
// what a compiled SourcePawn plugin starts with, little-endian
const SMX_MAGIC = 0x53504646;
const ADMIN_LINE = /^\s*"([^"]+)"\s+"([^"]*)"/;
const PAPERBOARD_ADMIN = "99:z";
// the files a Source server reads to load Metamod, from addons/
const LOADER_32 = "metamod.vdf";
const LOADER_X64 = "metamod_x64.vdf";

export const SOURCEMOD_MISSING = "SourceMod is on, but its files are missing from the server folder. Turn it off and on again in Mods to reinstall it.";

export function pluginFile(value: unknown): string {
    if (typeof value !== "string" || !PLUGIN_FILE.test(value)) throw new Error("Choose a plugin by its .smx file name");
    return value;
}

async function exists(file: string): Promise<boolean> {
    return fs.lstat(file).then(() => true, (err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return false; throw err; });
}

export class SourceMod {
    constructor(private readonly root: string) {}

    get addons() { return path.join(this.root, "addons"); }
    get cfg() { return path.join(this.root, "cfg", "sourcemod"); }
    private get plugins() { return path.join(this.addons, "sourcemod", "plugins"); }
    private get disabled() { return path.join(this.plugins, "disabled"); }
    private get adminsFile() { return path.join(this.addons, "sourcemod", "configs", "admins_simple.ini"); }

    /** What Mods shows: the plugins, and whether SourceMod is on without its files (its next start would fail). */
    async view(on: boolean): Promise<{ missing: boolean; plugins: SourcePlugin[] }> {
        const installed = await this.installed();
        return { missing: on && !installed, plugins: on || installed ? await this.list() : [] };
    }

    /** Both halves are there: Metamod's 64-bit loader and SourceMod's own folder. */
    async installed(): Promise<boolean> {
        return (await exists(path.join(this.addons, LOADER_X64))) && (await exists(path.join(this.addons, "sourcemod", "bin")));
    }

    /**
     * Copies Metamod:Source and SourceMod from their packages (each a bin/
     * holding addons/, and SourceMod's cfg/) into the server folder. Files
     * already there stay: they are the user's configs and plugins. Metamod's
     * 32-bit loader stays out: the panel runs 64-bit servers, which would try
     * it beside the x64 one and log failing to load it on every start.
     */
    async install(metamod: string, sourcemod: string): Promise<void> {
        const metamodAddons = path.join(metamod, "addons");
        for (const [from, to] of [[metamodAddons, this.addons], [path.join(sourcemod, "addons"), this.addons], [path.join(sourcemod, "cfg", "sourcemod"), this.cfg]] as const) {
            if (!(await exists(from))) throw new Error(`The package has no ${path.relative(path.dirname(path.dirname(from)), from)} folder`);
            await fs.mkdir(to, { recursive: true });
            await fs.cp(from, to, { recursive: true, force: false, errorOnExist: false, filter: (source) => source !== path.join(metamodAddons, LOADER_32) });
        }
        if (!(await this.installed())) throw new Error("SourceMod did not install completely; install it again");
    }

    async list(): Promise<SourcePlugin[]> {
        const read = async (dir: string, enabled: boolean) => {
            let names: string[];
            try { names = await fs.readdir(dir); }
            catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return []; throw err; }
            return names.filter((n) => n.toLowerCase().endsWith(".smx")).map((file): SourcePlugin => {
                const known = BUNDLED_PLUGINS[file.slice(0, -4)];
                return { file, title: known?.title ?? file.slice(0, -4), description: known?.description ?? "Uploaded by you", enabled, bundled: !!known };
            });
        };
        const plugins = [...(await read(this.plugins, true)), ...(await read(this.disabled, false))];
        return plugins.sort((a, b) => Number(b.bundled === false) - Number(a.bundled === false) || a.title.localeCompare(b.title));
    }

    /** Moves a plugin between plugins/ and plugins/disabled/; false when it already was so. */
    async setEnabled(raw: unknown, enabled: boolean): Promise<boolean> {
        const file = pluginFile(raw);
        const on = path.join(this.plugins, file);
        const off = path.join(this.disabled, file);
        const [from, to] = enabled ? [off, on] : [on, off];
        if (await exists(to)) return false;
        if (!(await exists(from))) throw new Error(`${file} is not installed`);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(from, to);
        return true;
    }

    /** Deletes a plugin the user added; SourceMod's own are turned off instead. */
    async remove(raw: unknown): Promise<void> {
        const file = pluginFile(raw);
        if (BUNDLED_PLUGINS[file.slice(0, -4)]) throw new Error(`${file} comes with SourceMod; turn it off instead`);
        let removed = false;
        for (const dir of [this.plugins, this.disabled]) {
            if (await exists(path.join(dir, file))) { await fs.rm(path.join(dir, file)); removed = true; }
        }
        if (!removed) throw new Error(`${file} is not installed`);
    }

    /**
     * Adds the compiled plugins in a staging folder, turned on; a plugin of
     * the same name is replaced where it is. Anything that is not a .smx
     * refuses the whole upload before a file moves.
     */
    async upload(stage: string): Promise<string[]> {
        let names: string[];
        try { names = await fs.readdir(stage); }
        catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Nothing was uploaded. Choose the files again."); throw err; }
        if (names.length === 0) throw new Error("Nothing was uploaded. Choose the files again.");
        for (const name of names) {
            if (!PLUGIN_FILE.test(name)) throw new Error(`${name} is not a SourceMod plugin. Upload the compiled .smx, not the .sp source.`);
            if (BUNDLED_PLUGINS[name.slice(0, -4)]) throw new Error(`${name} has the name of a plugin SourceMod comes with; rename it`);
            const head = Buffer.alloc(4);
            const handle = await fs.open(path.join(stage, name), "r");
            try { await handle.read(head, 0, 4, 0); } finally { await handle.close(); }
            if (head.readUInt32LE(0) !== SMX_MAGIC) throw new Error(`${name} is not a compiled SourceMod plugin`);
        }
        await fs.mkdir(this.plugins, { recursive: true });
        for (const name of names) {
            const target = (await exists(path.join(this.disabled, name))) ? path.join(this.disabled, name) : path.join(this.plugins, name);
            await fs.copyFile(path.join(stage, name), target);
        }
        return names;
    }

    /** Steam ids with full admin rights in admins_simple.ini. */
    async admins(): Promise<string[]> {
        const text = await this.readAdmins();
        return text.split("\n").map((line) => ADMIN_LINE.exec(line)).filter((m) => m && m[2]!.split(":").pop()!.includes("z")).map((m) => m![1]!);
    }

    /** Gives a Steam id full admin rights, or takes every right the file gives it away; the rest of the file stays as it was. */
    async setAdmin(steamId: string, admin: boolean): Promise<void> {
        const text = await this.readAdmins();
        const lines = text.split("\n").filter((line) => ADMIN_LINE.exec(line)?.[1] !== steamId);
        while (lines.length > 0 && lines.at(-1) === "") lines.pop();
        if (admin) lines.push(`"${steamId}" "${PAPERBOARD_ADMIN}"`);
        await fs.mkdir(path.dirname(this.adminsFile), { recursive: true });
        await fs.writeFile(this.adminsFile, lines.join("\n") + "\n");
    }

    private async readAdmins(): Promise<string> {
        try { return (await fs.readFile(this.adminsFile, "utf8")).replace(/\r\n/g, "\n"); }
        catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return ""; throw err; }
    }
}
