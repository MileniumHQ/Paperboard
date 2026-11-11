// A dropdown whose choices its panel works out when they're asked for (the
// worlds a server has now), or the values a type lists (the servers there
// are): the latter in a block of its own, so a block can take its place.
// It asks each time it opens; until the answer comes it shows what it was
// last told. A value no longer offered stays as
// it was saved, so a flow never changes under you: running it says the
// choice is gone.
import * as Blockly from "blockly";
import type { BlockChoice } from "@mileniumhq/paperapi";

export const CHOICES_FIELD = "pb_field_choices";

/** Which input of which block a dropdown's choices belong to, or which type's values it lists (in a project, or not). */
export type ChoicesSource = { panelId: string; entry: string; input: string } | { typeRef: string; project?: string };

/** What an optional dropdown of a type's values says for leaving it out: "none", or "any" for an event's filter. */
export type EmptyChoice = "none" | "any";

export interface ChoicesBackend {
    fetch(source: ChoicesSource): Promise<BlockChoice[]>;
    /** a fetch that failed, said where the person sees it */
    report(message: string): void;
}

let backend: ChoicesBackend | null = null;
const known = new Map<string, Blockly.MenuOption[]>();

const keyOf = (s: ChoicesSource) => ("typeRef" in s ? `type\u0000${s.typeRef}\u0000${s.project ?? ""}` : `${s.panelId}\u0000${s.entry}\u0000${s.input}`);

/** A choice's value as the field keeps it: JSON, as the static dropdowns do. */
export const choiceValue = (value: BlockChoice["value"]) => JSON.stringify(value);

/** An optional dropdown left out: nothing, which runs as a missing input. */
export const NO_CHOICE = JSON.stringify(null);

/** A saved choice's label: its value as text. A value that isn't JSON was never one of ours, so it fails. */
function labelOf(value: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (err) {
        throw new Error(`The saved choice ${value} can't be read: ${err instanceof Error ? err.message : String(err)}`);
    }
    return typeof parsed === "string" ? parsed : String(parsed);
}

/** Asks the panel for a dropdown's choices now, and keeps them for every dropdown of that input. */
export async function refreshChoices(source: ChoicesSource): Promise<void> {
    if (!backend) throw new Error("The choices dropdown was used before registerChoicesField");
    const choices = await backend.fetch(source);
    known.set(
        keyOf(source),
        choices.map((c) => [c.label, choiceValue(c.value)]),
    );
}

/**
 * The project a type's values are listed in for a dropdown: the project of
 * the block it's in, when that block is one of the type's own panel's.
 * Set by the editor, which knows how blocks are named.
 */
let projectOf: (holder: Blockly.Block | null, typeRef: string) => string | undefined = () => undefined;

export function setChoicesProject(find: typeof projectOf): void {
    projectOf = find;
}

interface FieldConfig {
    panelId?: string;
    entry?: string;
    input?: string;
    typeRef?: string;
    empty?: EmptyChoice;
}

class ChoicesField extends Blockly.FieldDropdown {
    // set after super(): the generator below runs inside it, before fields exist
    declare private config: FieldConfig;
    declare private incoming: string | undefined;

    static override fromJson(options: Blockly.FieldDropdownFromJsonConfig & FieldConfig): ChoicesField {
        const { panelId, entry, input, typeRef, empty } = options;
        if (!typeRef && (!panelId || !entry || !input)) throw new Error(`${CHOICES_FIELD} needs panelId, entry and input, or a typeRef`);
        return new ChoicesField(typeRef ? { typeRef, ...(empty ? { empty } : {}) } : { panelId, entry, input });
    }

    constructor(config: FieldConfig) {
        super(function (this: Blockly.FieldDropdown) {
            return (this as ChoicesField).menu();
        });
        this.config = config;
        // super() asked before the field knew its input: ask again, and start on the first choice as a dropdown does
        this.setValue(this.getOptions(false)[0]![1]);
    }

    /** Where the choices come from now: a type's are listed in the project of the block holding this one. */
    private source(): ChoicesSource | null {
        const c = this.config;
        if (!c) return null;
        if (c.typeRef) {
            const holder = this.getSourceBlock()?.getParent() ?? null;
            const project = projectOf(holder, c.typeRef);
            return { typeRef: c.typeRef, ...(project ? { project } : {}) };
        }
        return { panelId: c.panelId!, entry: c.entry!, input: c.input! };
    }

    private menu(): Blockly.MenuOption[] {
        const source = this.source();
        const offered = source ? (known.get(keyOf(source)) ?? []) : [];
        // leaving an optional input out is a choice of its own, first
        const options: Blockly.MenuOption[] = this.config?.empty ? [[this.config.empty, NO_CHOICE], ...offered] : [...offered];
        for (const value of [this.incoming, this.getValue()]) {
            if (value && !options.some((o) => o[1] === value)) options.push([labelOf(value), value]);
        }
        // Blockly needs one option; an empty choice runs as a missing input, which the panel names
        return options.length ? options : [["none", choiceValue("")]];
    }

    protected override doClassValidation_(value?: string): string | null {
        if (typeof value !== "string") return null;
        this.incoming = value;
        this.getOptions(false);
        this.incoming = undefined;
        return value;
    }

    protected override showEditor_(e?: MouseEvent): void {
        const source = this.source();
        if (!source) throw new Error("This dropdown was opened before it knew where its choices come from");
        refreshChoices(source).then(
            () => {
                this.getOptions(false);
                super.showEditor_(e);
            },
            (err: unknown) => {
                backend?.report(`The choices for this dropdown couldn't be loaded: ${err instanceof Error ? err.message : String(err)}`);
                super.showEditor_(e);
            },
        );
    }
}

/** Registers the field with Blockly, asking `with` for choices. */
export function registerChoicesField(with_: ChoicesBackend): void {
    backend = with_;
    if (!Blockly.registry.hasItem(Blockly.registry.Type.FIELD, CHOICES_FIELD)) Blockly.fieldRegistry.register(CHOICES_FIELD, ChoicesField);
}
