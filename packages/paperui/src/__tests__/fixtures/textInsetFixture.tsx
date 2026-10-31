import { render } from "solid-js/web";
import { PaperFlex, PaperProvider, PaperSectionHeader, PaperSettingItem, PaperSettingList, PaperText } from "../../index";
import "../../styles/styles.css";

const dispose = render(() => <PaperProvider><PaperFlex direction="column" gap="half" style={{ width: "360px" }}>
    <PaperSectionHeader data-testid="header" icon="lan" title="Ports" />
    <PaperSettingList autoHeight>
        <PaperSettingItem title="Refuse taken ports" description="Shown under the row title." />
    </PaperSettingList>
    <PaperText data-testid="hint" preset="hint" inset>
        A panel asks where to keep its backups the first time it makes one. Its later backups go to the same place.
    </PaperText>
    <PaperText data-testid="error" preset="error">The setting was not saved.</PaperText>
    <PaperText data-testid="text" preset="text">App copy.</PaperText>
    <PaperText data-testid="body" preset="body">Reading copy.</PaperText>
</PaperFlex></PaperProvider>, document.getElementById("app")!);

const lineLefts = (el: Element) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()].map((rect) => rect.left);
};
const style = (el: Element) => getComputedStyle(el);
const color = (token: string) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
};

const checks: Record<string, unknown> = {};
try {
    const header = document.querySelector('[data-testid="header"]')!;
    const headerIcon = header.querySelector(".material-symbols-rounded, [class*=icon]")!;
    const heading = header.querySelector('[data-preset="heading"]')!;
    const label = document.querySelector('[data-preset="label"]')!;
    const hint = document.querySelector('[data-testid="hint"]')!;
    const description = document.querySelector('[data-preset="hint"]:not([data-testid])')!;
    const lefts = lineLefts(hint);

    // the header starts where the row's text starts, and so does inset text on every wrapped line
    checks.headerAlignsWithRow = headerIcon.getBoundingClientRect().left === label.getBoundingClientRect().left;
    checks.insetWraps = lefts.length > 1;
    checks.insetAlignsWithRow = lefts.every((left) => left === label.getBoundingClientRect().left);

    checks.heading = [style(heading).fontSize, style(heading).fontWeight, style(heading).color === color("--paper-text-subtle")];
    checks.label = [style(label).fontSize, style(label).fontWeight];
    checks.hint = [style(description).fontSize, style(description).fontWeight, style(description).color === color("--paper-text-subtle")];
    const error = document.querySelector('[data-testid="error"]')!;
    checks.error = [style(error).fontSize, style(error).color === color("--paper-danger")];
    const text = document.querySelector('[data-testid="text"]')!;
    const body = document.querySelector('[data-testid="body"]')!;
    checks.textLeading = style(text).lineHeight;
    checks.bodyLeading = parseFloat(style(body).lineHeight) / parseFloat(style(body).fontSize);
    document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error: "" }))}`;
} catch (error) {
    document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error: String(error) }))}`;
} finally {
    dispose();
}
