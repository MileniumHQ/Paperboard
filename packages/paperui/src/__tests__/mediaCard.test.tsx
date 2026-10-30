import { fireEvent, render } from "@solidjs/testing-library";
import { describe, it, expect } from "vitest";
import { PaperMediaCard } from "../components/PaperMediaCard";

describe("PaperMediaCard footer controls", () => {
    it("a footer button does its own thing without also opening the card", () => {
        const opened: string[] = [];
        const { getByText, getByRole } = render(() => (
            <PaperMediaCard
                title="Project"
                onClick={() => opened.push("card")}
                footerRight={<button onClick={() => opened.push("button")}>Rename</button>}
            />
        ));
        fireEvent.click(getByText("Rename"));
        expect(opened).toEqual(["button"]);
        fireEvent.click(getByText("Project"));
        expect(opened).toEqual(["button", "card"]);
        // Enter on the card itself opens it; Enter on the footer button doesn't
        fireEvent.keyDown(getByText("Rename"), { key: "Enter" });
        expect(opened).toEqual(["button", "card"]);
        fireEvent.keyDown(getByRole("button", { name: /Project/ }), { key: "Enter" });
        expect(opened).toEqual(["button", "card", "card"]);
    });
});
