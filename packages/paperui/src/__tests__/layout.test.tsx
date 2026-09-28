import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { PaperFlex } from "../templates/PaperFlex";
import { PaperText } from "../components/PaperText";
import { PaperSettingList } from "../templates/PaperSettingList";
import { PaperList, PaperListItem } from "../components/PaperList";
import settingListStyles from "../templates/PaperSettingList/index.module.css";

describe("PaperLayout and Components Layout Enhancements", () => {
    it("renders PaperFlex with flex, shrink, and layout props", () => {
        const { getByTestId } = render(() => (
            <PaperFlex
                data-testid="flex-box"
                flex
                shrink={0}
                grow={1}
                minHeight={0}
                fullWidth
            >
                Child
            </PaperFlex>
        ));

        const el = getByTestId("flex-box");
        expect(el.style.flexShrink).toBe("0");
        expect(el.style.flexGrow).toBe("1");
        expect(el.style.minHeight).toBe("0px");
        expect(el.style.width).toBe("100%");
    });

    it("renders PaperText with breakWord and truncate", () => {
        const { getByTestId } = render(() => (
            <PaperText
                data-testid="text-box"
                breakWord
                truncate
            >
                Super long text
            </PaperText>
        ));

        const el = getByTestId("text-box");
        expect(el.style.wordBreak).toBe("break-word");
        expect(el.style.overflow).toBe("hidden");
        expect(el.style.textOverflow).toBe("ellipsis");
        expect(el.style.whiteSpace).toBe("nowrap");
    });

    it("renders PaperSettingList with default flex and autoHeight prop", () => {
        const { getByTestId } = render(() => (
            <PaperSettingList data-testid="setting-list" autoHeight>
                Items
            </PaperSettingList>
        ));

        const el = getByTestId("setting-list");
        expect(el.className).toBeTruthy();
    });

    it("renders PaperSettingList flat for full-bleed panes", () => {
        const { getByTestId } = render(() => (
            <PaperSettingList data-testid="flat-list" flat>
                Items
            </PaperSettingList>
        ));

        const el = getByTestId("flat-list");
        expect(el.classList.contains(settingListStyles.flat)).toBe(true);
    });

    it("renders PaperList with borderless, fullWidth, and scrollable props", () => {
        const { getByTestId } = render(() => (
            <PaperList
                name="test-list"
                data-testid="paper-list"
                borderless
                fullWidth
                fullHeight
                scrollable
            >
                <PaperListItem value="item1">Item 1</PaperListItem>
            </PaperList>
        ));

        const el = getByTestId("paper-list");
        expect(el.style.width).toBe("100%");
        expect(el.style.height).toBe("100%");
        expect(el.style.overflow).toBe("auto");
    });
});
