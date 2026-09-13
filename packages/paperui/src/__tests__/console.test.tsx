import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
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
});
