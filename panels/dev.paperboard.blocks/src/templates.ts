// The flows a new project can start with. Each is built from blocks that
// exist now: Blocks' own, and the registry's as it answers when the project
// is made, so a template that needs a panel says what it needs instead of
// leaving blocks on the canvas that can't run.
import { blockEntry, errorMessage, type BlockChoice, type BlockInfo, type BlockProjectInfo } from "@mileniumhq/paperapi";
import { choiceValue } from "./lib/choicesField";
import { registryDefinitions, type Definitions } from "./lib/blockDefs";
import { BUILTIN, parseEntry, registryBlockType } from "./lib/names";
import type { SavedBlock, SavedWorkspace } from "./lib/interpreter";
import type { SavedFlows } from "./panel";

type Json = Record<string, unknown>;

/** What the registry offers as the project is made. */
export interface TemplateRegistry {
    entries: BlockInfo[];
    projects: BlockProjectInfo[];
    /** the values each type a template picks one of lists (CHOSEN_TYPES), or why they couldn't be listed */
    choices: Record<string, BlockChoice[] | { failed: string }>;
}

export type Built = { flows: SavedFlows } | { unavailable: string };

export interface Template {
    id: string;
    name: string;
    description: string;
    icon: string;
    /** whether it is built from other panels' blocks, so it waits for the registry */
    needsRegistry: boolean;
    build(registry: TemplateRegistry): Built;
}

const GAME_SERVER = "dev.paperboard.gameserver";
const GAME_SERVER_NAME = "Game Server";
const SERVER_TYPE = `${GAME_SERVER}:server`;

/** The types a template fills an input of with the first value they list, read with the registry. */
export const CHOSEN_TYPES = [SERVER_TYPE];

/** The first value a type lists, as a dropdown keeps it; or why there is none. */
function firstChoice(registry: TemplateRegistry, typeRef: string, what: string): { value: string } | { unavailable: string } {
    const listed = registry.choices[typeRef];
    if (!listed) throw new Error(`${typeRef} wasn't listed with the registry`);
    if ("failed" in listed) return { unavailable: `Couldn't list the ${what}: ${listed.failed}` };
    if (!listed.length) return { unavailable: `Make a ${what.replace(/s$/, "")} in ${GAME_SERVER_NAME} first` };
    return { value: choiceValue(listed[0]!.value) };
}

/** Reads what each of CHOSEN_TYPES lists; a type whose panel isn't here lists nothing. */
export async function readChoices(entries: BlockInfo[], list: (typeRef: string) => Promise<BlockChoice[]>): Promise<TemplateRegistry["choices"]> {
    const offered = CHOSEN_TYPES.filter((typeRef) => entries.some((e) => e.panelId === typeRef.slice(0, typeRef.indexOf(":"))));
    const read = await Promise.all(offered.map(async (typeRef) => [typeRef, await list(typeRef).catch((err: unknown) => ({ failed: errorMessage(err) }))] as const));
    return Object.fromEntries([...CHOSEN_TYPES.map((typeRef) => [typeRef, []] as const), ...read]);
}

const text = (t: string): Json => ({ shadow: { type: "text", fields: { TEXT: t } } });
const num = (n: number): Json => ({ shadow: { type: "math_number", fields: { NUM: n } } });
const join = (...parts: Json[]): Json => ({ block: { type: "text_join", extraState: { itemCount: parts.length }, inputs: Object.fromEntries(parts.map((p, i) => [`ADD${i}`, p])) } });
const log = (value: Json): Json => ({ type: BUILTIN.log, inputs: { TEXT: value } });
/** Steps one under another. */
const steps = (...blocks: Json[]): Json => blocks.reduceRight<Json | undefined>((next, block) => ({ block: { ...block, ...(next ? { next } : {}) } }), undefined)!;

/** Gives every block an id, as Blockly would: the service names a schedule and a failure by its block's. */
function identified(block: Json): SavedBlock {
    const out: Json = { ...block, id: crypto.randomUUID() };
    if (block.inputs) {
        out.inputs = Object.fromEntries(
            Object.entries(block.inputs as Record<string, Json>).map(([name, input]) => [
                name,
                { ...(input.block ? { block: identified(input.block as Json) } : {}), ...(input.shadow ? { shadow: identified(input.shadow as Json) } : {}) },
            ]),
        );
    }
    if (block.next) out.next = { block: identified((block.next as Json).block as Json) };
    return out as unknown as SavedBlock;
}

/** Every block type a saved block holds. */
function typesIn(block: SavedBlock, into = new Set<string>()): Set<string> {
    into.add(block.type);
    for (const input of Object.values(block.inputs ?? {})) for (const held of [input.block, input.shadow]) if (held) typesIn(held, into);
    if (block.next?.block) typesIn(block.next.block, into);
    return into;
}

/** The stacks laid out one under another, with the schemas their panels' blocks need saved with them. */
function flowsOf(stacks: Json[], defs?: Definitions): SavedFlows {
    const blocks = stacks.map((stack, i) => ({ ...identified(stack), x: 0, y: i * 200 }));
    const workspace: SavedWorkspace = { blocks: { languageVersion: 0, blocks } };
    const used = new Set(blocks.flatMap((b) => [...typesIn(b)]).flatMap((type) => [type, ...(defs?.uses[type] ?? [])]));
    const schemas = Object.fromEntries(Object.entries(defs?.schemas ?? {}).filter(([type]) => used.has(type)));
    return { workspace, schemas };
}

/** The block as its panel's Library lists it, its inputs filled with what they start as. */
function libraryBlock(defs: Definitions, type: string): Json {
    for (const section of defs.sections) {
        const found = section.contents.find((b) => b.type === type);
        if (found) {
            const { kind: _kind, ...block } = structuredClone(found);
            return block;
        }
    }
    throw new Error(`${type} isn't in the Library`);
}

/** Why a Game Server template can't be made yet, or null when it can. */
function gameServerMissing(registry: TemplateRegistry): string | null {
    if (!registry.entries.some((e) => e.panelId === GAME_SERVER)) return `Needs the ${GAME_SERVER_NAME} panel`;
    if (!registry.projects.some((p) => p.panelId === GAME_SERVER)) return `Make a server in ${GAME_SERVER_NAME} first`;
    return null;
}

export const TEMPLATES: Template[] = [
    {
        id: "nightly-restart",
        name: "Restart a game server every night",
        description: "Every day at 04:00, restarts the server you pick",
        icon: "restart_alt",
        needsRegistry: true,
        build: (registry) => {
            const missing = gameServerMissing(registry);
            if (missing) return { unavailable: missing };
            const entry = blockEntry("command", "restart-server");
            if (!registry.entries.some((e) => e.panelId === GAME_SERVER && e.entry === entry)) return { unavailable: `This ${GAME_SERVER_NAME} can't restart servers from Blocks; update it` };
            const server = firstChoice(registry, SERVER_TYPE, "servers");
            if ("unavailable" in server) return server;
            const defs = registryDefinitions(registry.entries, registry.projects);
            const restart = libraryBlock(defs, registryBlockType({ kind: "command", panelId: GAME_SERVER, entry }));
            // the server it restarts starts as the first one, as the dropdown would; the service runs what is saved
            const picked = (restart.inputs as Record<string, { shadow?: Json }> | undefined)?.server?.shadow;
            if (!picked) throw new Error("Restart Server has no server to pick");
            picked.fields = { VALUE: server.value };
            return { flows: flowsOf([{ type: BUILTIN.everyDay, fields: { TIME: "04:00" }, inputs: { DO: steps(restart) } }], defs) };
        },
    },
    {
        id: "backup-failed",
        name: "Log when a backup fails",
        description: "Says in the Console which game server's backup failed, and why",
        icon: "error",
        needsRegistry: true,
        build: (registry) => {
            const missing = gameServerMissing(registry);
            if (missing) return { unavailable: missing };
            const failures = registry.entries.filter((e) => {
                const at = parseEntry(e.entry);
                const server = registry.projects.some((p) => p.panelId === GAME_SERVER && p.id === at.project);
                return e.panelId === GAME_SERVER && server && at.kind === "event" && at.id === "backup-failed" && e.schema.kind === "event" && e.schema.values?.error;
            });
            if (!failures.length) return { unavailable: `This ${GAME_SERVER_NAME} doesn't say when a backup fails; update it` };
            const defs = registryDefinitions(registry.entries, registry.projects);
            // one flow for each server, which names it
            const stacks = failures.map((e) => {
                const server = registry.projects.find((p) => p.panelId === GAME_SERVER && p.id === parseEntry(e.entry).project)!;
                const hat = libraryBlock(defs, registryBlockType({ kind: "event", panelId: GAME_SERVER, entry: e.entry }));
                const why = { block: { type: registryBlockType({ kind: "event-value", panelId: GAME_SERVER, entry: e.entry, key: "error" }) } };
                return { ...hat, inputs: { ...(hat.inputs as Json | undefined), DO: steps(log(join(text(`${server.name}'s backup failed: `), why))) } };
            });
            return { flows: flowsOf(stacks, defs) };
        },
    },
    {
        id: "count-runs",
        name: "Count runs with Data",
        description: "Each time you click Run, counts one more and logs the count, which a restart keeps",
        icon: "exposure_plus_1",
        needsRegistry: false,
        build: () => ({
            flows: flowsOf([
                {
                    type: BUILTIN.onRun,
                    inputs: {
                        DO: steps(
                            { type: BUILTIN.dataChange, inputs: { KEY: text("runs"), BY: num(1) } },
                            log(join(text("Runs so far: "), { block: { type: BUILTIN.dataGet, inputs: { KEY: text("runs"), DEFAULT: num(0) } } })),
                        ),
                    },
                },
            ]),
        }),
    },
];
