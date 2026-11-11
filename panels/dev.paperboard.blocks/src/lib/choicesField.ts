// A dropdown whose choices its panel works out when they're asked for (the
// worlds a server has now). It asks each time it opens; until the answer
// comes it shows what it was last told. A value no longer offered stays as
// it was saved, so a flow never changes under you: running it says the
// choice is gone.
import * as Blockly from "blockly";
import type { BlockChoice } from "@mileniumhq/paperapi";

export const CHOICES_FIELD = "pb_field_choices";

/** Which input of which block a dropdown's choices belong to. */
export interface ChoicesSource {
    panelId: string;
    entry: string;
    input: string;
}

export interface ChoicesBackend {
    fetch(source: ChoicesSource): Promise<BlockChoice[]>;
    /** a fetch that failed, said where the person sees it */
    report(message: string): void;
}

let backend: ChoicesBackend | null = null;
const known = new Map<string, Blockly.MenuOption[]>();

const keyOf = (s: ChoicesSource) => `${s.panelId}\u0000${s.entry}\u0000${s.input}`;

/** A choice's value as the field keeps it: JSON, as the static dropdowns do. */
export const choiceValue = (value: BlockChoice["value"]) => JSON.stringify(value);

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

class ChoicesField extends Blockly.FieldDropdown {
    // set after super(): the generator below runs inside it, before fields exist
    declare private source: ChoicesSource;
    declare private incoming: string | undefined;

    static override fromJson(options: Blockly.FieldDropdownFromJsonConfig & Partial<ChoicesSource>): ChoicesField {
        const { panelId, entry, input } = options;
        if (!panelId || !entry || !input) throw new Error(`${CHOICES_FIELD} needs panelId, entry and input`);
        return new ChoicesField({ panelId, entry, input });
    }

    constructor(source: ChoicesSource) {
        super(function (this: Blockly.FieldDropdown) {
            return (this as ChoicesField).menu();
        });
        this.source = source;
        // super() asked before the field knew its input: ask again, and start on the first choice as a dropdown does
        this.setValue(this.getOptions(false)[0]![1]);
    }

    private menu(): Blockly.MenuOption[] {
        const offered = this.source ? (known.get(keyOf(this.source)) ?? []) : [];
        const options = [...offered];
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
        refreshChoices(this.source).then(
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
