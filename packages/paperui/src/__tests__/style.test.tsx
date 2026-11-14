import { describe, expect, test } from "vitest";
import { render } from "@solidjs/testing-library";
import { PaperButton, PaperFlex, PaperText } from "../index";

// Inventory: Layout — A component's style prop is applied, never dropped.
describe("a style prop", () => {
    test("given as text or as an object, is applied over the component's own style", () => {
        const { container } = render(() => (
            <>
                <PaperButton id="text" style="margin-top: 7px; color: rgb(1, 2, 3)">
                    Text
                </PaperButton>
                <PaperText id="object" style={{ "margin-top": "9px" }}>
                    Object
                </PaperText>
                <PaperFlex id="over" gap="full" style="gap: 3px">
                    Over
                </PaperFlex>
            </>
        ));
        const el = (id: string) => container.querySelector<HTMLElement>(`#${id}`)!;

        expect(el("text").style.marginTop).toBe("7px");
        expect(el("text").style.color).toBe("rgb(1, 2, 3)");
        expect(el("object").style.marginTop).toBe("9px");
        // the caller's declaration wins over the component's own
        expect(el("over").style.gap).toBe("3px");
        expect(el("over").style.flexDirection).toBe("column");
    });
});
