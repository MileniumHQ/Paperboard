// The field text is typed into. Empty, it shows what goes in it, the way
// PaperUI's inputs do: the type of the socket it fills ("Text", "Player",
// "URL"), faint. Blockly's text block wraps its field in big quote marks;
// this panel's text block is just the field.
import * as Blockly from "blockly";

export const TEXT_FIELD = "pb_field_text";
/** the class of a field showing its placeholder */
export const PLACEHOLDER_CLASS = "paperFieldPlaceholder";

/** What fills a text field's socket, by the block the field's block plugs into and that block's input. */
let placeholderOf: (parent: Blockly.Block | null, input: string | null) => string = () => {
    throw new Error("The text field was drawn before setTextPlaceholders");
};

/** Says what each socket's text field shows when empty; the page knows each panel's input names. */
export function setTextPlaceholders(resolve: (parent: Blockly.Block | null, input: string | null) => string): void {
    placeholderOf = resolve;
}

export class PaperTextField extends Blockly.FieldTextInput {
    private placeholder = "";

    static override fromJson(options: Blockly.FieldTextInputFromJsonConfig): PaperTextField {
        return new PaperTextField(options.text ?? "");
    }

    /** Works out the placeholder where the field's block sits now; called as its block is drawn, so a change is measured. */
    refreshPlaceholder(): void {
        const block = this.getSourceBlock();
        const parent = block?.getParent() ?? null;
        const next = placeholderOf(parent, parent && block ? (parent.getInputWithBlock(block)?.name ?? null) : null);
        if (next === this.placeholder) return;
        this.placeholder = next;
        if (!this.getValue()) this.isDirty_ = true;
    }

    protected override getDisplayText_(): string {
        return this.getValue() ? super.getDisplayText_() : this.placeholder;
    }

    protected override render_(): void {
        super.render_();
        this.textElement_?.classList.toggle(PLACEHOLDER_CLASS, !this.getValue());
    }
}

if (!Blockly.registry.hasItem(Blockly.registry.Type.FIELD, TEXT_FIELD)) Blockly.fieldRegistry.register(TEXT_FIELD, PaperTextField);

/** Blockly's text block, without its quote marks. */
export const TEXT_BLOCK = {
    type: "text",
    message0: "%1",
    args0: [{ type: TEXT_FIELD, name: "TEXT", text: "" }],
    output: "String",
    style: "text_blocks",
    tooltip: "A piece of text",
};
