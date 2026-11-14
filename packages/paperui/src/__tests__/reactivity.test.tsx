import { describe, expect, test } from "vitest";
import { createSignal, For } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import {
    PaperButton,
    PaperChart,
    PaperCheckbox,
    PaperConsole,
    PaperEmptyState,
    PaperInput,
    PaperList,
    PaperListItem,
    PaperMarkdown,
    PaperMediaCard,
    PaperMenu,
    PaperMenuItem,
    PaperMenuSection,
    PaperSelector,
    PaperSelectorItem,
    PaperSettingItem,
    PaperSettingList,
    PaperToggle,
    PaperWidget,
    PaperWidgetRows,
    PaperWizard,
    PaperWizardStep,
    type PaperConsoleEntry,
    type PaperWidgetRow,
} from "../index";

/** An element that counts how many times it was built. */
function probes() {
    const built: Record<string, number> = {};
    const Probe = (props: { name: string }) => {
        built[props.name] = (built[props.name] ?? 0) + 1;
        return <span data-probe={props.name}>{props.name}</span>;
    };
    return { built, Probe };
}

// Inventory: Core contracts — a JSX prop is one element.
describe("JSX props are built once", () => {
    test("a component's icon, title, description and actions each build one element", () => {
        const { built, Probe } = probes();
        render(() => (
            <PaperEmptyState icon={<Probe name="icon" />} title={<Probe name="title" />} description={<Probe name="description" />}>
                <Probe name="actions" />
            </PaperEmptyState>
        ));
        expect(built).toEqual({ icon: 1, title: 1, description: 1, actions: 1 });
        expect(document.querySelectorAll("[data-probe]").length).toBe(4);
    });

    test("a widget's header, action and footer each build one element", () => {
        const { built, Probe } = probes();
        render(() => (
            <PaperWidget title={<Probe name="title" />} icon={<Probe name="icon" />} detail={<Probe name="detail" />} action={<Probe name="action" />} footer={<Probe name="footer" />}>
                body
            </PaperWidget>
        ));
        expect(built).toEqual({ title: 1, icon: 1, detail: 1, action: 1, footer: 1 });
    });

    test("an icon button's content builds once", () => {
        const { built, Probe } = probes();
        render(() => (
            <PaperButton icon aria-label="Probe">
                <Probe name="glyph" />
            </PaperButton>
        ));
        expect(built).toEqual({ glyph: 1 });
    });

    test("a media card builds its banner and slots once, and keeps its element when it stops being pressable", () => {
        const { built, Probe } = probes();
        const [disabled, setDisabled] = createSignal(false);
        render(() => (
            <PaperMediaCard
                title="World"
                banner={<Probe name="banner" />}
                badge={<Probe name="badge" />}
                footerLeft={<Probe name="footerLeft" />}
                disabled={disabled()}
                onClick={() => {}}
            >
                <Probe name="content" />
            </PaperMediaCard>
        ));
        const card = screen.getByRole("button");
        setDisabled(true);
        setDisabled(false);
        expect(built).toEqual({ banner: 1, badge: 1, footerLeft: 1, content: 1 });
        expect(document.querySelector("[data-probe='banner']")?.closest("[aria-disabled], [role='button']")).toBe(card);
    });

    test("a console's empty state is built once however many entries flush", () => {
        const { built, Probe } = probes();
        const [entries, setEntries] = createSignal<PaperConsoleEntry[]>([]);
        render(() => <PaperConsole entries={entries()} empty={<Probe name="empty" />} banner={<Probe name="banner" />} />);
        for (let i = 0; i < 5; i++) setEntries([...entries(), { type: "output", content: `line ${i}` }]);
        setEntries([]);
        expect(built).toEqual({ empty: 1, banner: 1 });
    });
});

const radio = (name: string) => screen.getByDisplayValue(name) as HTMLInputElement;

// Inventory: Menus and form controls — Selection follows its items and its parent.
describe("selection items", () => {
    test("an item mounted disabled can be chosen once it is enabled", () => {
        const chosen: (string | number)[] = [];
        const [disabled, setDisabled] = createSignal(true);
        render(() => (
            <PaperSelector name="mode" onValueChange={(v) => chosen.push(v)}>
                <PaperSelectorItem value="easy">Easy</PaperSelectorItem>
                <PaperSelectorItem value="hard" disabled={disabled()}>
                    Hard
                </PaperSelectorItem>
            </PaperSelector>
        ));
        setDisabled(false);
        fireEvent.click(radio("hard"));
        expect(chosen).toEqual(["hard"]);
    });

    test("an item whose value changes chooses its new value", () => {
        const chosen: (string | number)[] = [];
        const [value, setValue] = createSignal("old");
        render(() => (
            <PaperMenu name="page" onValueChange={(v) => chosen.push(v)}>
                <PaperMenuItem value={value()}>Page</PaperMenuItem>
            </PaperMenu>
        ));
        setValue("new");
        fireEvent.click(radio("new"));
        expect(chosen).toEqual(["new"]);
    });

    test("a choice the parent refuses leaves the inputs showing what is chosen, so pressing it again still asks", () => {
        const asked: (string | number)[] = [];
        render(() => (
            <PaperSelector name="mode" value="easy" onValueChange={(v) => asked.push(v)}>
                <PaperSelectorItem value="easy">Easy</PaperSelectorItem>
                <PaperSelectorItem value="hard">Hard</PaperSelectorItem>
            </PaperSelector>
        ));
        fireEvent.click(radio("hard"));
        expect(radio("hard").checked).toBe(false);
        expect(radio("easy").checked).toBe(true);
        fireEvent.click(radio("hard"));
        expect(asked).toEqual(["hard", "hard"]);
    });

    test("a list of buttons chooses the item already chosen again when it is pressed", () => {
        const chosen: (string | number)[] = [];
        render(() => (
            <PaperList name="pages" buttons value="home" onValueChange={(v) => chosen.push(v)}>
                <PaperListItem value="home">Home</PaperListItem>
                <PaperListItem value="logs">Logs</PaperListItem>
            </PaperList>
        ));
        fireEvent.click(radio("home"));
        fireEvent.click(radio("logs"));
        expect(chosen).toEqual(["home", "logs"]);
    });

    test("a list that is not buttons does not choose the chosen item again", () => {
        const chosen: (string | number)[] = [];
        render(() => (
            <PaperList name="pages" value="home" onValueChange={(v) => chosen.push(v)}>
                <PaperListItem value="home">Home</PaperListItem>
            </PaperList>
        ));
        fireEvent.click(radio("home"));
        expect(chosen).toEqual([]);
    });
});

// Inventory: Menus and form controls — A controlled control shows its prop.
describe("controlled controls the parent refuses", () => {
    test("a text field goes back to its value after a change the parent did not take", () => {
        render(() => <PaperInput aria-label="Name" value="Survival" onChange={() => {}} />);
        const input = screen.getByLabelText("Name") as HTMLInputElement;
        input.value = "Creative";
        fireEvent.change(input);
        expect(input.value).toBe("Survival");
    });

    test("a checkbox's native input keeps the checked state the parent holds", () => {
        const asked: boolean[] = [];
        render(() => <PaperCheckbox name="pvp" label="PvP" checked={false} onChange={(c) => asked.push(c)} />);
        fireEvent.click(screen.getByText("PvP"));
        expect(asked).toEqual([true]);
        expect((document.querySelector("input[name='pvp']") as HTMLInputElement).checked).toBe(false);
    });

    test("a controlled setting list shows its value, not what a control asked for", () => {
        const asked: Record<string, unknown>[] = [];
        render(() => (
            <PaperSettingList value={{ notify: false }} onValueChange={(v) => asked.push(v)}>
                <PaperSettingItem title="Notifications">
                    <PaperToggle name="notify" aria-label="Notifications" />
                </PaperSettingItem>
            </PaperSettingList>
        ));
        fireEvent.click(screen.getByRole("switch"));
        expect(asked).toEqual([{ notify: true }]);
        expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    });

    test("a controlled menu section asks to open or close", () => {
        const asked: boolean[] = [];
        render(() => (
            <PaperMenu name="nav">
                <PaperMenuSection title="Worlds" open onOpenChange={(o) => asked.push(o)}>
                    <PaperMenuItem value="overworld">Overworld</PaperMenuItem>
                </PaperMenuSection>
            </PaperMenu>
        ));
        fireEvent.click(screen.getByText("Worlds"));
        expect(asked).toEqual([false]);
        expect(screen.getByText("Overworld")).toBeTruthy();
    });
});

// Inventory: Core contracts — Lists keep their elements across new data.
describe("elements that persist across new data", () => {
    test("widget rows keep each id's element across a new rows array and show the new row", () => {
        const [rows, setRows] = createSignal<PaperWidgetRow[]>([
            { id: "alex", label: "Alex" },
            { id: "sam", label: "Sam" },
        ]);
        render(() => <PaperWidgetRows rows={rows()} />);
        const alex = screen.getByText("Alex").closest("li");
        setRows([
            { id: "kai", label: "Kai" },
            { id: "alex", label: "Alex (AFK)", detail: "5m" },
        ]);
        expect(screen.getByText("Alex (AFK)").closest("li")).toBe(alex);
        expect(screen.getByText("5m").closest("li")).toBe(alex);
        expect(screen.queryByText("Sam")).toBeNull();
        expect([...document.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Kai", "Alex (AFK)5m"]);
    });

    test("widget rows with the same id twice throw", () => {
        expect(() =>
            render(() => (
                <PaperWidgetRows
                    rows={[
                        { id: "a", label: "A" },
                        { id: "a", label: "B" },
                    ]}
                />
            )),
        ).toThrow(/two rows have the id "a"/);
    });

    test("markdown keeps the blocks text streaming in does not touch", () => {
        const [text, setText] = createSignal("Intro\n\n```js\nrun()\n```\n\nThe answer");
        const { container } = render(() => <PaperMarkdown text={text()} />);
        const code = container.querySelector("pre");
        const intro = screen.getByText("Intro");
        setText(`${text()} is still`);
        setText(`${text()} coming.\n\nMore`);
        expect(container.querySelector("pre")).toBe(code);
        expect(screen.getByText("Intro")).toBe(intro);
        expect(container.textContent).toContain("The answer is still coming.");
        expect(container.textContent).toContain("More");
    });

    test("markdown reads every block again when a reference link's definition arrives", () => {
        const [text, setText] = createSignal("See [docs]");
        const { container } = render(() => <PaperMarkdown text={text()} />);
        expect(container.querySelector("a")).toBeNull();
        setText("See [docs]\n\n[docs]: https://paperboard.dev");
        expect(container.querySelector("a")?.getAttribute("href")).toBe("https://paperboard.dev");
    });

    test("a donut keeps its slices across new data, so they slide to their new sizes", () => {
        const [used, setUsed] = createSignal(30);
        const { container } = render(() => (
            <PaperChart label="Disk" segments={[{ label: "Used", value: used() }, { label: "Free", value: 100 - used() }]} />
        ));
        const slices = [...container.querySelectorAll("circle")].slice(1);
        const before = slices.map((s) => s.getAttribute("stroke-dasharray"));
        setUsed(60);
        const after = [...container.querySelectorAll("circle")].slice(1);
        expect(after).toEqual(slices);
        expect(after.map((s) => s.getAttribute("stroke-dasharray"))).not.toEqual(before);
    });
});

// Inventory: Menus and form controls — Wizard step activation.
describe("PaperWizard step activation", () => {
    test("onStepActive runs once each time its step becomes current, not when what it reads changes", () => {
        const [seen, setSeen] = createSignal(0);
        const [canProceed, setCanProceed] = createSignal(true);
        const active: number[] = [];
        render(() => (
            <PaperWizard>
                <For each={[0, 1]}>
                    {(index) => (
                        <PaperWizardStep
                            index={index}
                            canProceed={canProceed()}
                            onStepActive={() => {
                                active.push(index);
                                seen();
                            }}
                        >
                            Step {index}
                        </PaperWizardStep>
                    )}
                </For>
            </PaperWizard>
        ));
        expect(active).toEqual([0]);
        setSeen(1);
        setCanProceed(false);
        setCanProceed(true);
        expect(active).toEqual([0]);
        fireEvent.click(screen.getByRole("button", { name: /Next/ }));
        expect(active).toEqual([0, 1]);
    });
});
