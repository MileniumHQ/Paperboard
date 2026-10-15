import { describe, test, expect, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperWidget, PaperWidgetMessage, PaperWidgetRows, PaperWidgetStat } from "../templates/PaperWidget";

describe("PaperWidget", () => {
    test("draws the header only when there is something to put in it", () => {
        const titled = render(() => <PaperWidget title="Network" detail="2 adapters">body</PaperWidget>);
        expect(titled.getByText("Network")).toBeTruthy();
        expect(titled.getByText("2 adapters")).toBeTruthy();
        // a face widget, like a clock, has no header: only the body
        const face = render(() => <PaperWidget>12:00</PaperWidget>);
        const layout = face.container.firstElementChild!.firstElementChild!;
        expect(layout.children.length).toBe(1);
        expect(layout.textContent).toBe("12:00");
    });

    test("a stat follows its value as it changes", () => {
        const [value, setValue] = createSignal("1 KB/s");
        const { getByText } = render(() => <PaperWidgetStat value={value()} caption="Receiving" />);
        setValue("2 KB/s");
        expect(getByText("2 KB/s")).toBeTruthy();
    });

    test("a toned stat colors through its role", () => {
        const { container } = render(() => <PaperWidgetStat value="Offline" tone="danger" />);
        const stat = container.firstElementChild as HTMLElement;
        expect(stat.style.getPropertyValue("--role-base")).toContain("--paper-danger");
    });
});

describe("a pressable PaperWidget", () => {
    // the content lets presses through to the tile's button only on a
    // pressable tile (index.module.css keys on data-pressable); any other
    // widget's body keeps its own clicks, hovers and scroll
    test("only a pressable tile is marked to pass presses through", () => {
        const plain = render(() => <PaperWidget title="Chart">body</PaperWidget>);
        expect(plain.container.firstElementChild!.hasAttribute("data-pressable")).toBe(false);
        const pressable = render(() => <PaperWidget title="Backup" onPress={() => {}} pressLabel="Run Backup">body</PaperWidget>);
        expect(pressable.container.firstElementChild!.hasAttribute("data-pressable")).toBe(true);
    });

    test("is one named button, and does not press when disabled", () => {
        const press = vi.fn();
        const live = render(() => <PaperWidget title="Backup" onPress={press} pressLabel="Run Backup">body</PaperWidget>);
        fireEvent.click(live.getByRole("button", { name: "Run Backup" }));
        expect(press).toHaveBeenCalledTimes(1);
        const off = render(() => <PaperWidget title="Backup" onPress={press} pressLabel="Run Backup" pressDisabled>body</PaperWidget>);
        fireEvent.click(off.getByRole("button", { name: "Run Backup" }));
        expect(press).toHaveBeenCalledTimes(1);
        // without onPress there is no button at all
        expect(render(() => <PaperWidget title="Backup">body</PaperWidget>).queryByRole("button")).toBeNull();
    });
});

describe("PaperWidgetRows", () => {
    test("a row with onClick is a named button; one without is not", () => {
        const open = vi.fn();
        const { container, getByRole } = render(() => (
            <PaperWidgetRows
                rows={[
                    { id: "a", label: "Game Server", detail: "Running", tone: "success", ariaLabel: "Game Server, running. Open", onClick: open },
                    { id: "b", label: "Notes", detail: "No service", tone: "none" },
                ]}
            />
        ));
        fireEvent.click(getByRole("button", { name: "Game Server, running. Open" }));
        expect(open).toHaveBeenCalledTimes(1);
        expect(container.querySelectorAll("button").length).toBe(1);
        expect(container.querySelectorAll("li").length).toBe(2);
    });
});

describe("PaperWidgetMessage", () => {
    test("a failure is an alert, an empty state is a status, and both offer their way out", () => {
        const retry = vi.fn();
        const failed = render(() => (
            <PaperWidgetMessage title="Not answering" tone="danger">
                <button type="button" onClick={retry}>Retry</button>
            </PaperWidgetMessage>
        ));
        fireEvent.click(failed.getByRole("alert").querySelector("button")!);
        expect(retry).toHaveBeenCalledTimes(1);
        const empty = render(() => <PaperWidgetMessage title="No one is online" />);
        expect(empty.getByRole("status").textContent).toContain("No one is online");
    });
});
