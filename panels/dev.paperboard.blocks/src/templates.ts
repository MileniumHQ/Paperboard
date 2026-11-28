// The flows a new project can start with: Blocks' own, and the ones panels
// register (blocksApi's templates). A panel's is built from the blocks the
// registry has as the project is made, so a template that can't be made yet
// says why instead of leaving blocks on the canvas that can't run.
import {
    blockEntry,
    errorMessage,
    type BlockChoice,
    type BlockInfo,
    type BlockProjectInfo,
    type BlockTemplateInfo,
    type BlockTemplateValue,
} from "@mileniumhq/paperapi";
import { choiceValue } from "./lib/choicesField";
import { inText, registryDefinitions, type Definitions } from "./lib/blockDefs";
import { BUILTIN, registryBlockType } from "./lib/names";
import type { SavedBlock, SavedWorkspace } from "./lib/interpreter";
import type { SavedFlows } from "./panel";

type Json = Record<string, unknown>;

/** What the registry offers as the project is made. */
export interface TemplateRegistry {
    entries: BlockInfo[];
    projects: BlockProjectInfo[];
    templates: BlockTemplateInfo[];
    /** each panel's name, by id */
    panelNames: Record<string, string>;
    /** what each type a template needs lists ("panel:type"), or why it couldn't be listed */
    choices: Record<string, BlockChoice[] | { failed: string }>;
}

export type Built = { flows: SavedFlows } | { unavailable: string };

/** One template New project offers. */
export interface Template {
    /** unique in the dialog: Blocks' own by id, a panel's as "panel/id" */
    key: string;
    name: string;
    description: string;
    icon: string;
    build(): Built;
}

const needed = (info: BlockTemplateInfo) => (info.template.needs ? `${info.panelId}:${info.template.needs}` : null);

/** Lists what each type the templates need has now; one that fails says why in its templates. */
export async function readChoices(templates: BlockTemplateInfo[], list: (typeRef: string) => Promise<BlockChoice[]>): Promise<TemplateRegistry["choices"]> {
    const types = [...new Set(templates.map(needed).filter((t) => t !== null))];
    return Object.fromEntries(await Promise.all(types.map(async (typeRef) => [typeRef, await list(typeRef).catch((err: unknown) => ({ failed: errorMessage(err) }))] as const)));
}

const text = (t: string): Json => ({ shadow: { type: "text", fields: { TEXT: t } } });
const num = (n: number): Json => ({ shadow: { type: "math_number", fields: { NUM: n } } });
const join = (...parts: Json[]): Json => (parts.length === 1 ? parts[0]! : { block: { type: "text_join", extraState: { itemCount: parts.length }, inputs: Object.fromEntries(parts.map((p, i) => [`ADD${i}`, p])) } });
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

/** Why a panel's template can't be made now. */
class Unavailable extends Error {}

/** The input's editable block, set to start as the value. */
function startAs(shadow: Json, value: BlockTemplateValue): void {
    if (shadow.type === "text") shadow.fields = { TEXT: String(value) };
    else if (shadow.type === "math_number") shadow.fields = { NUM: Number(value) };
    else if (shadow.type === "logic_boolean") shadow.fields = { BOOL: value ? "TRUE" : "FALSE" };
    // a dropdown: of the input's choices, or of the values its type lists
    else shadow.fields = { VALUE: choiceValue(value) };
}

/** Makes a panel's template from the blocks the registry has now, or says why it can't. */
export function buildTemplate({ panelId, template }: BlockTemplateInfo, registry: TemplateRegistry): Built {
    const panel = registry.panelNames[panelId] ?? panelId;
    const typeRef = needed({ panelId, template });
    let first: BlockTemplateValue | undefined;
    if (typeRef) {
        const type = registry.entries.find((e) => e.panelId === panelId && e.entry === blockEntry("type", template.needs!));
        const listed = registry.choices[typeRef];
        if (!type || !listed) return { unavailable: `${panel} doesn't list its ${template.needs} values; update it` };
        const what = inText(type.schema.name);
        if ("failed" in listed) return { unavailable: `Couldn't list the ${what} values: ${listed.failed}` };
        if (!listed.length) return { unavailable: `Make a ${what} in ${panel} first` };
        first = listed[0]!.value;
    }
    const projects = template.eachProject ? registry.projects.filter((p) => p.panelId === panelId) : [undefined];
    if (!projects.length) return { unavailable: `${panel} has nothing to make it for yet` };
    const defs = registryDefinitions(registry.entries, registry.projects);

    /** One of the panel's blocks, as the Library has it, its inputs started as the template says. */
    const block = (kind: "command" | "event", id: string, given: Record<string, BlockTemplateValue> | undefined, project: BlockProjectInfo | undefined) => {
        const entry = blockEntry(kind, id, project?.id);
        const info = registry.entries.find((e) => e.panelId === panelId && e.entry === entry);
        if (!info) throw new Unavailable(`${panel} has no ${kind} "${id}"${project ? ` in ${project.name}` : ""}; update it`);
        const made = libraryBlock(defs, registryBlockType({ kind, panelId, entry }));
        const inputs = ("inputs" in info.schema ? info.schema.inputs : undefined) ?? {};
        for (const key of Object.keys(given ?? {})) if (!inputs[key]) throw new Unavailable(`${info.schema.name} has no input "${key}"`);
        for (const [key, input] of Object.entries(inputs)) {
            // a required input of the type it needs starts as the first; an optional one as the Library has it (none, or any)
            const value = given?.[key] ?? (input.type === typeRef && !input.optional ? first : undefined);
            if (value === undefined) continue;
            const shadow = (made.inputs as Record<string, { shadow?: Json }> | undefined)?.[key]?.shadow;
            if (!shadow) throw new Unavailable(`${info.schema.name}'s ${input.name} can't start as a value`);
            startAs(shadow, value);
        }
        return { made, info };
    };

    try {
        const stacks = projects.map((project) => {
            const { when } = template;
            const hat = "event" in when ? block("event", when.event, when.inputs, project) : null;
            const fired = hat?.info.schema.kind === "event" ? (hat.info.schema.values ?? {}) : {};
            const body = template.steps.map((step) => {
                if ("command" in step) return block("command", step.command, step.inputs, project).made;
                // "{key}" is a value the event fires; "{project}" the project's name. Neighbouring text reads as one
                const parts: (string | Json)[] = [];
                step.log.split(/\{([^}]*)\}/).forEach((part, i) => {
                    const said = i % 2 === 0 ? part : part === "project" && project ? project.name : null;
                    if (said === null) {
                        if (!hat || !fired[part]) throw new Unavailable(`${template.name} logs {${part}}, which its event doesn't fire`);
                        parts.push({ block: { type: registryBlockType({ kind: "event-value", panelId, entry: hat.info.entry, key: part }) } });
                    } else if (typeof parts.at(-1) === "string") parts[parts.length - 1] += said;
                    else if (said) parts.push(said);
                });
                return log(join(...parts.map((p) => (typeof p === "string" ? text(p) : p))));
            });
            if (!hat) return { type: BUILTIN.everyDay, fields: { TIME: (when as { everyDay: string }).everyDay }, inputs: { DO: steps(...body) } };
            return { ...hat.made, inputs: { ...(hat.made.inputs as Json | undefined), DO: steps(...body) } };
        });
        return { flows: flowsOf(stacks, defs) };
    } catch (err) {
        if (err instanceof Unavailable) return { unavailable: err.message };
        throw err;
    }
}

/** A panel's template as New project offers it. */
export function registeredTemplate(info: BlockTemplateInfo, registry: TemplateRegistry): Template {
    const { id, name, description, icon } = info.template;
    return { key: `${info.panelId}/${id}`, name, description, icon, build: () => buildTemplate(info, registry) };
}

/** Blocks' own, made of its own blocks. */
export const OWN_TEMPLATES: Template[] = [
    {
        key: "count-runs",
        name: "Count runs with Data",
        description: "Each time you click Run, counts one more and logs the count, which a restart keeps",
        icon: "exposure_plus_1",
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
