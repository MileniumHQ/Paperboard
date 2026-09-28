// Real ActionBlock/VariableMenu behavior harness for the browser test.
// Mounts the panel's own components (PaperUI swapped for the DOM stub) and
// drives the exact interactions the fixes describe: click a field, click a
// chip, insert a variable, press Backspace, type Enter into a multiline
// field. Results are base64 JSON in #results so the test can read them from
// Chrome's --dump-dom output.
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import ActionBlock from "../../src/components/ActionBlock";
import VariableMenu from "../../src/components/VariableMenu";
import { textBuiltins } from "../../src/lib/builtin/text";

interface FixtureResults {
    checks: Record<string, unknown>;
    error: string;
}

const out: FixtureResults = { checks: {}, error: "" };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function schemaOf(id: string): any {
    const found = textBuiltins.find((builtin) => builtin.id === id);
    if (!found?.item.schema) throw new Error(`builtin ${id} has no schema`);
    return found.item.schema;
}

function mountAction(container: HTMLElement, schema: any) {
    const pickerCalls: any[][] = [];
    const optionCalls: any[][] = [];
    let insertChip: ((varId: string, label: string, icon: string) => void) | undefined;
    let lastValue: unknown;
    render(() => {
        const [values, setValues] = createSignal<Record<string, unknown>>({});
        return (
            <ActionBlock
                id="block-1"
                action={schema}
                values={values()}
                onValueChange={(_id, key, value) => {
                    lastValue = value;
                    setValues((prev) => ({ ...prev, [key]: value }));
                }}
                onRequestVariablePicker={(...args: any[]) => {
                    pickerCalls.push(args);
                    insertChip = args[4];
                }}
                onRequestOptionPicker={(...args: any[]) => {
                    optionCalls.push(args);
                }}
            />
        );
    }, container);
    return {
        pickerCalls,
        optionCalls,
        insert: (varId: string, label: string, icon: string) => insertChip?.(varId, label, icon),
        lastValue: () => lastValue,
    };
}

function click(el: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
        new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            // ceil keeps the click on the right half of the target even when
            // the center is a fraction of a pixel
            clientX: Math.ceil(rect.left + rect.width / 2),
            clientY: Math.ceil(rect.top + rect.height / 2),
        }),
    );
}

function keydown(el: HTMLElement, key: string): boolean {
    return el.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
}

async function waitForDocumentFocus(): Promise<boolean> {
    for (let i = 0; i < 100; i++) {
        if (document.hasFocus()) return true;
        await sleep(8);
    }
    return document.hasFocus();
}

async function run(): Promise<void> {
    if (!(await waitForDocumentFocus())) {
        throw new Error("the document never gained focus");
    }

    // 1. the builtin Text action is the one multiline field: Enter inserts a
    // line break and keeps editing instead of committing and blurring
    const multilineRoot = document.createElement("div");
    document.body.appendChild(multilineRoot);
    const multiline = mountAction(multilineRoot, schemaOf("text"));
    await tick();
    const multilineField = multilineRoot.querySelector<HTMLElement>(".actionEditable");
    if (!multilineField) throw new Error("Text action rendered no editable field");
    out.checks.multilineFieldFound =
        multilineField.classList.contains("actionEditableMultiline");
    multilineField.focus({ preventScroll: true });
    document.execCommand("insertText", false, "one");
    keydown(multilineField, "Enter");
    out.checks.multilineEnterKeptFocus = document.activeElement === multilineField;
    out.checks.multilineAfterEnterDom = JSON.stringify(multilineField.textContent);
    // now a stored two-line value must survive the commit unchanged
    multilineField.textContent = "one\ntwo";
    multilineField.dispatchEvent(new InputEvent("input", { bubbles: true }));
    multilineField.blur();
    await tick();
    out.checks.multilineCommittedValue = multiline.lastValue();

    // 2. a single-line field: focus requests the picker anchored to the
    // field, and a click does not request it a second time; clicking the chip does too (no extra click elsewhere needed);
    // one Backspace removes the chip and its invisible anchors
    const joinRoot = document.createElement("div");
    document.body.appendChild(joinRoot);
    const join = mountAction(joinRoot, schemaOf("text-join"));
    await tick();
    const joinField = joinRoot.querySelector<HTMLElement>(".actionEditable");
    if (!joinField) throw new Error("Join Text action rendered no editable field");
    out.checks.joinFieldMultiline = joinField.classList.contains("actionEditableMultiline");

    // focus alone (keyboard, programmatic) brings the picker up
    joinField.focus({ preventScroll: true });
    out.checks.pickerRequestsAfterFocus = join.pickerCalls.length;
    out.checks.lockedWrapWidth = joinField.parentElement?.style.width ?? "";
    keydown(joinField, "Enter");
    out.checks.singleLineEnterBlurred = document.activeElement !== joinField;
    out.checks.releasedWrapWidth = joinField.parentElement?.style.width ?? "";

    click(joinField);
    out.checks.pickerRequestsAfterFieldClick = join.pickerCalls.length;
    out.checks.pickerAnchorIsField = join.pickerCalls[0]?.[7] === joinField;

    join.insert("blk1", "Username", "person");
    await tick();
    const chip = joinField.querySelector<HTMLElement>(".actionVariableChip");
    out.checks.chipInserted = chip !== null;
    out.checks.chipCommittedValue = join.lastValue();

    if (chip) {
        click(chip);
        out.checks.pickerRequestsAfterChipClick = join.pickerCalls.length;

        const notPrevented = keydown(joinField, "Backspace");
        out.checks.backspacePrevented = !notPrevented;
        out.checks.chipRemoved = joinField.querySelector(".actionVariableChip") === null;
        const residue = [...joinField.childNodes].filter(
            (node) =>
                node.nodeType === Node.TEXT_NODE &&
                (node.textContent || "").replace(/[\u200B\uFEFF]/g, "") === "",
        );
        out.checks.zeroWidthResidue = residue.length;
        out.checks.cleanCommittedValue = join.lastValue();
    }

    // a chip removed through a selection (cut, drag, range delete) must not
    // strand its anchors either
    join.insert("blk2", "Count", "tag");
    await tick();
    const selectedChip = joinField.querySelector<HTMLElement>(".actionVariableChip");
    if (selectedChip) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNode(selectedChip);
        selection?.removeAllRanges();
        selection?.addRange(range);
        range.deleteContents();
        joinField.dispatchEvent(new InputEvent("input", { bubbles: true }));
        out.checks.selectionDeleteResidue = [...joinField.childNodes].filter(
            (node) =>
                node.nodeType === Node.TEXT_NODE &&
                (node.textContent || "").replace(/[\u200B\uFEFF]/g, "") === "",
        ).length;
    }

    // 3. a clearable options input starts unselected, reads its empty label
    // ("(any)"), offers that entry first, and clearing passes undefined
    const clearableSchema = {
        id: "clearable-test",
        name: "Clearable Test",
        description: "",
        template: "Use {model}",
        inputs: {
            model: {
                type: "string",
                label: "Model",
                allowEmpty: true,
                emptyLabel: "(any)",
                options: [
                    { label: "qwen3:8b", value: "qwen3:8b" },
                    { label: "llama3:8b", value: "llama3:8b" },
                ],
            },
        },
    };
    const clearableRoot = document.createElement("div");
    document.body.appendChild(clearableRoot);
    const clearable = mountAction(clearableRoot, clearableSchema);
    await tick();
    const clearablePill = clearableRoot.querySelector<HTMLElement>(".actionInputOption");
    if (!clearablePill) throw new Error("clearable options input rendered no pill");
    out.checks.clearableStartsUnselected = clearablePill.textContent?.includes("(any)");

    click(clearablePill);
    const optionCall = clearable.optionCalls[0] ?? [];
    out.checks.clearablePickerValues = (optionCall[4] ?? []).map((o: any) => o.value);
    out.checks.clearableSelectedValue = optionCall[5] === null;
    out.checks.clearableAnchorIsPill = optionCall[7] === clearablePill;

    const choose = optionCall[6] as ((value: any) => void) | undefined;
    choose?.("qwen3:8b");
    await tick();
    out.checks.clearableChosenValue = clearable.lastValue();
    choose?.(null);
    await tick();
    out.checks.clearableClearsToUndefined = clearable.lastValue() === undefined;
    out.checks.clearableBackToEmptyLabel =
        clearableRoot.querySelector<HTMLElement>(".actionInputOption")?.textContent?.includes("(any)");

    // a plain options input without allowEmpty still shows its first option
    const plainSchema = {
        id: "plain-options-test",
        name: "Plain Options Test",
        description: "",
        template: "Pick {mode}",
        inputs: {
            mode: {
                type: "string",
                label: "Mode",
                options: [
                    { label: "Newest first", value: "newest" },
                    { label: "Most downloaded", value: "downloads" },
                ],
            },
        },
    };
    const plainRoot = document.createElement("div");
    document.body.appendChild(plainRoot);
    mountAction(plainRoot, plainSchema);
    await tick();
    out.checks.plainOptionsDefault = plainRoot
        .querySelector<HTMLElement>(".actionInputOption")
        ?.textContent?.includes("Newest first");

    // 4. the menu treats clicks inside its anchor field as edits, not
    // dismissals; only a click outside closes it
    const menuRoot = document.createElement("div");
    document.body.appendChild(menuRoot);
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    let closeCalls = 0;
    render(
        () => (
            <VariableMenu
                open={true}
                x={10}
                y={10}
                items={[]}
                anchor={anchor}
                onSelect={() => {}}
                onClose={() => {
                    closeCalls += 1;
                }}
            />
        ),
        menuRoot,
    );
    await tick();
    anchor.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    out.checks.anchorPointerDownCloseCalls = closeCalls;
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    out.checks.outsidePointerDownCloseCalls = closeCalls;
}

function finish(): void {
    const results = document.getElementById("results");
    if (results) results.textContent = "RESULT:" + btoa(JSON.stringify(out));
}

run()
    .catch((err) => {
        out.error = err instanceof Error ? (err.stack ?? String(err)) : String(err);
    })
    .finally(finish);
