import { describe, test, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { PaperChart, PaperChartLegend } from "../components/PaperChart";

const segments = [
    { label: "Game Server", value: 2, detail: "2 GB" },
    { label: "Paperboard", value: 1, color: "var(--paper-success)" },
];

describe("PaperChart", () => {
    test("is one image named by its label and every segment's reading", () => {
        render(() => <PaperChart label="Memory" segments={segments} total={4}>75%</PaperChart>);
        const chart = screen.getByRole("img");
        expect(chart.getAttribute("aria-label")).toBe("Memory: Game Server 2 GB, Paperboard 25%");
        expect(chart.textContent).toBe("75%");
    });

    test("a donut draws each segment's share of the total, one after the other", () => {
        const { container } = render(() => <PaperChart label="Memory" segments={segments} total={4} />);
        const slices = [...container.querySelectorAll("circle[pathLength]")];
        expect(slices.map((s) => s.getAttribute("stroke-dasharray"))).toEqual(["49.2 50.8", "24.2 75.8"]);
        expect(slices.map((s) => s.getAttribute("stroke-dashoffset"))).toEqual(["0", "-50"]);
    });

    test("segments take the palette in order unless they name a color", () => {
        const { container } = render(() => <PaperChart label="Memory" segments={segments} />);
        const slices = [...container.querySelectorAll<SVGCircleElement>("circle[pathLength]")];
        expect(slices.map((s) => s.style.stroke)).toEqual(["var(--paper-primary)", "var(--paper-success)"]);
    });

    test("a total smaller than the segments does not draw past the whole", () => {
        const { container } = render(() => <PaperChart type="bar" label="Disk" segments={segments} total={1} />);
        const widths = [...container.querySelectorAll<HTMLElement>("[role=img] > span")].map((s) => parseFloat(s.style.width));
        expect(widths[0] + widths[1]).toBeCloseTo(100);
    });

    test("negative, empty and non-numeric values draw nothing instead of breaking the chart", () => {
        const { container } = render(() => (
            <PaperChart
                type="bar"
                label="Disk"
                segments={[{ label: "Bad", value: Number.NaN }, { label: "Less", value: -3 }, { label: "None", value: 0 }]}
            />
        ));
        expect(container.querySelectorAll("[role=img] > span").length).toBe(0);
        expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Disk: Bad 0%, Less 0%, None 0%");
    });

    test("the legend lists the same readings and colors as the chart", () => {
        const { container } = render(() => <PaperChartLegend segments={segments} total={4} />);
        const rows = [...container.querySelectorAll("li")];
        expect(rows.map((r) => r.textContent)).toEqual(["Game Server2 GB", "Paperboard25%"]);
        expect((rows[0].firstElementChild as HTMLElement).style.background).toBe("var(--paper-primary)");
    });

    test("a compact legend names the parts without their readings", () => {
        const { container } = render(() => <PaperChartLegend segments={segments} total={4} compact />);
        expect([...container.querySelectorAll("li")].map((r) => r.textContent)).toEqual(["Game Server", "Paperboard"]);
    });
});
