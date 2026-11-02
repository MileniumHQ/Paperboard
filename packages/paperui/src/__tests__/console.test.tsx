import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperConsole, type PaperConsoleEntry } from "../components/PaperConsole";

describe("PaperConsole Component Tests", () => {
    test("renders banner, entries, and separated input correctly", () => {
        const entries: PaperConsoleEntry[] = [
            { type: "command", content: "help" },
            { type: "output", content: "Available commands: start, stop" },
            { type: "error", content: "ReferenceError: unknown cmd" },
            { type: "return", content: "undefined" },
        ];

        const { container } = render(() => (
            <PaperConsole
                banner="Server Interactive REPL"
                entries={entries}
                placeholder="Type a command..."
            />
        ));

        expect(screen.getByText("Server Interactive REPL")).toBeDefined();
        expect(screen.getByText("help")).toBeDefined();
        expect(screen.getByText("Available commands: start, stop")).toBeDefined();
        expect(screen.getByText("ReferenceError: unknown cmd")).toBeDefined();
        expect(screen.getByText("undefined")).toBeDefined();
        expect(screen.getByPlaceholderText("Type a command...")).toBeDefined();
        expect(container.querySelector("form")).toBeDefined();
    });

    test("triggers onCommand on enter and maintains history", async () => {
        const onCommand = vi.fn();
        render(() => <PaperConsole onCommand={onCommand} placeholder="Command..." />);

        const input = screen.getByPlaceholderText("Command...") as HTMLInputElement;

        fireEvent.input(input, { target: { value: "say Hello world" } });
        expect(input.value).toBe("say Hello world");

        const form = input.closest("form")!;
        fireEvent.submit(form);

        expect(onCommand).toHaveBeenCalledWith("say Hello world");
        expect(input.value).toBe("");

        fireEvent.keyDown(input, { key: "ArrowUp" });
        expect(input.value).toBe("say Hello world");
    });

    test("command history is capped instead of growing forever", async () => {
        render(() => <PaperConsole placeholder="Command..." />);

        const input = screen.getByPlaceholderText("Command...") as HTMLInputElement;
        const form = input.closest("form")!;
        for (let i = 0; i < 250; i++) {
            fireEvent.input(input, { target: { value: `cmd-${i}` } });
            fireEvent.submit(form);
        }

        // oldest dropped: the first recallable command is cmd-50, not cmd-0
        fireEvent.keyDown(input, { key: "ArrowUp" });
        for (let i = 0; i < 199; i++) {
            fireEvent.keyDown(input, { key: "ArrowUp" });
        }
        expect(input.value).toBe("cmd-50");
    });

    test("a long log mounts only a window of rows, ending on the newest", () => {
        const entries = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
        const { container } = render(() => <PaperConsole showInput={false} entries={entries} />);

        const rows = container.querySelectorAll("[class*='entry']:not([class*='entries'])");
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThan(200);
        expect(screen.getByText("line 4999")).toBeDefined();
        expect(screen.queryByText("line 0")).toBeNull();
    });

    test("a row whose height flickers by a subpixel settles instead of re-measuring forever", () => {
        // real layouts report heights like 24.40625 and 24.4063720703125 for
        // the same row depending on where it sits
        const flicker = [24.40625, 24.4063720703125];
        let measured = 0;
        const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => {
            measured++;
            // stop flickering eventually so a regression fails instead of hanging
            const height = measured < 5000 ? flicker[measured % 2] : flicker[0];
            return { height, width: 100, top: 0, left: 0, right: 100, bottom: height, x: 0, y: 0, toJSON() {} } as DOMRect;
        });
        const client = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
        try {
            const entries = Array.from({ length: 100 }, (_, i) => `line ${i}`);
            render(() => <PaperConsole showInput={false} entries={entries} />);
            expect(measured).toBeLessThan(1000);
        } finally {
            rect.mockRestore();
            client.mockRestore();
        }
    });

    test("a burst of lines lands in one frame and keeps the window bounded", async () => {
        const [entries, setEntries] = createSignal<string[]>([]);
        const { container } = render(() => <PaperConsole showInput={false} entries={entries()} />);

        for (let i = 0; i < 3000; i++) {
            setEntries((prev) => [...prev, `burst ${i}`]);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(screen.getByText("burst 2999")).toBeDefined();
        const rows = container.querySelectorAll("[class*='entry']:not([class*='entries'])");
        expect(rows.length).toBeLessThan(200);
    });

    test("an empty console shows its empty state until the first line arrives", async () => {
        const [entries, setEntries] = createSignal<PaperConsoleEntry[]>([]);
        render(() => <PaperConsole entries={entries()} empty={<p>Nothing printed yet</p>} />);
        expect(screen.queryByText("Nothing printed yet")).not.toBeNull();
        setEntries([{ type: "output", content: "Server started" }]);
        expect(await screen.findByText("Server started")).toBeDefined();
        expect(screen.queryByText("Nothing printed yet")).toBeNull();
    });
});
