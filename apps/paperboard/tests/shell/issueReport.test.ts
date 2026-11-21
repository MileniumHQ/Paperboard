// Report an Issue in the real shell: empty state with featured agents and
// Check again, streaming console rows that keep untouched DOM identity,
// Esc/backdrop protection while working and on a written issue, Discord link
// copying before opening without discarding the issue, and GitHub filing.
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { IssueReportSetup } from "../../src/shared/shellContract";
import { ELECTRON_PRELOAD } from "./support/electronPreload";
import { bootShell, clickText, type Shell } from "./support/shell";

let shell: Shell;

const statusToastShown = (...texts: string[]): string =>
    `[...document.querySelectorAll("[aria-label=Notifications] [role=status]")].some((t) => ${JSON.stringify(texts)}.every((x) => t.innerText.includes(x)))`;

const LINKS: IssueReportSetup["links"] = [
    { label: "Discord", description: "Opens the Paperboard Discord server.", includesIssue: false },
    { label: "Email Maintainer", description: "Opens a new email to Paperboard in your mail app.", includesIssue: true },
];

const FEATURED = ["Claude Code", "Codex", "Cursor", "Grok", "OpenCode", "Antigravity"];

const AGENTS: IssueReportSetup["agents"] = [
    { id: "claude", name: "Claude" },
    { id: "codex", name: "Codex" },
    { id: "antigravity", name: "Antigravity" },
];

const DIALOG = `document.querySelector("[role=dialog]")`;
const DIALOG_OPEN = `(${DIALOG}?.getAttribute("aria-modal") === "true")`;
const DIALOG_CLOSED = `!${DIALOG_OPEN}`;

beforeAll(async () => {
    shell = await bootShell({ init: ELECTRON_PRELOAD });
    await shell.host({
        cmd: "issue-report-configure",
        setup: { prompt: "What went wrong in Paperboard?", agents: [], known: FEATURED, links: LINKS },
    });
    const { page } = shell;
    await page.click("[role=radio][aria-label='Settings']");
    await page.waitFor(
        `[...document.querySelectorAll("button")].some((b) => b.textContent.includes("Report an Issue"))`,
        "Report an Issue button in App Settings",
    );
});

afterAll(async () => {
    await shell?.close();
});

test("empty state names featured agents concisely and reloads when Check again is clicked", async () => {
    const { page } = shell;
    await clickText(page, "button", "Report an Issue");
    await page.waitFor(`${DIALOG_OPEN} && ${DIALOG}.innerText.includes("No coding agent found")`, "empty state");

    const text = await page.evaluate<string>(`${DIALOG}.innerText`);
    expect(text).toContain("Claude Code, Codex, Cursor, Grok, OpenCode, or Antigravity");
    const docsHref = await page.evaluate<string | null>(`${DIALOG}.querySelector("a")?.getAttribute("href") ?? null`);
    expect(docsHref).toBe("https://paperboard.dev/docs/paperboard/troubleshooting/#report-an-issue");

    // installing an agent and clicking Check again transitions straight to the form
    await shell.host({
        cmd: "issue-report-configure",
        setup: { prompt: "What went wrong in Paperboard?", agents: AGENTS, known: FEATURED, links: LINKS },
    });
    await clickText(page, "button", "Check again");
    await page.waitFor(`${DIALOG}.querySelector("textarea") && ${DIALOG}.innerText.includes("Claude")`, "agent form");
    expect(page.exceptions).toEqual([]);
});

test("streaming keeps untouched console rows intact and Esc or backdrop never stops a run", async () => {
    const { page } = shell;
    await page.type("[role=dialog] textarea", "Game Server says Stopped after restart");
    await clickText(page, "button", "Investigate");

    const reportId = await shell.host({ cmd: "issue-report-wait-start" });
    await page.waitFor(`${DIALOG}.innerText.includes("Investigating")`, "console view");

    // header close button is absent while working
    expect(await page.evaluate<boolean>(`!!${DIALOG}.querySelector("[aria-label='Close modal']")`)).toBe(false);

    // stream two rows, mark the first row's DOM node, then stream an update to the second row
    await shell.host({
        cmd: "issue-report-push",
        entry: { reportId, id: "e0", kind: "tool", text: "Read apps/paperboard/src/main/index.ts", status: "completed" },
    });
    await shell.host({
        cmd: "issue-report-push",
        entry: { reportId, id: "e1", kind: "message", text: "Checking **startup** path" },
    });
    await page.waitFor(`${DIALOG}.innerText.includes("Checking startup path")`, "initial streamed rows");

    await page.evaluate(`(() => {
        const rows = [...document.querySelectorAll("[role=dialog] [class*='entry']")];
        const first = rows.find((el) => el.textContent.includes("Read apps/paperboard/src/main/index.ts"));
        if (!first) throw new Error("first console row not found");
        window.__firstConsoleRow = first;
    })()`);

    await shell.host({
        cmd: "issue-report-push",
        entry: { reportId, id: "e1", kind: "message", text: "Checking **startup** path and supervisor handoff" },
    });
    await page.waitFor(`${DIALOG}.innerText.includes("supervisor handoff")`, "streamed markdown update");

    const sameNode = await page.evaluate<boolean>(`(() => {
        const rows = [...document.querySelectorAll("[role=dialog] [class*='entry']")];
        const first = rows.find((el) => el.textContent.includes("Read apps/paperboard/src/main/index.ts"));
        return first === window.__firstConsoleRow;
    })()`);
    expect(sameNode).toBe(true);

    // Esc and backdrop click must not close the modal or stop the agent
    await page.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await page.evaluate(`(() => {
        const backdrop = document.querySelector("[role=dialog]")?.parentElement;
        backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    })()`);
    await page.settled();

    expect(await page.evaluate<boolean>(DIALOG_OPEN)).toBe(true);
    expect((await shell.host({ cmd: "issue-report-state" })).stopped).toEqual([]);

    // Stop explicitly ends the run and keeps the description
    await clickText(page, "button", "Stop");
    await page.waitFor(`!!${DIALOG}.querySelector("textarea")`, "back to describe after Stop");
    expect(await page.evaluate<string>(`${DIALOG}.querySelector("textarea").value`)).toBe("Game Server says Stopped after restart");
    expect((await shell.host({ cmd: "issue-report-state" })).stopped).toEqual([reportId]);
    expect(page.exceptions).toEqual([]);
});

test("written issue survives Esc/reopen, Discord copies without discarding, and GitHub filing clears and closes", async () => {
    const { page } = shell;
    await clickText(page, "button", "Investigate");
    const firstId = await shell.host({ cmd: "issue-report-wait-start" });
    await shell.host({
        cmd: "issue-report-finish",
        result: {
            status: "written",
            title: "Game Server says Stopped after restart",
            body: "The status view misses the reconnect event.",
            text: "Title: Game Server says Stopped after restart\n\nIssue Content:\nThe status view misses the reconnect event.",
            github: { repo: "MileniumHQ/Paperboard", state: "missing" },
        },
    });
    await page.waitFor(`${DIALOG}.innerText.includes("Copy and open Discord")`, "written issue defaulting to Discord");
    expect(await page.evaluate<string>(`${DIALOG}.innerText`)).toContain("Copies the issue to your clipboard first.");

    // closing with Esc keeps the written issue when reopened
    await page.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await page.waitFor(DIALOG_CLOSED, "modal closed by Esc");
    await clickText(page, "button", "Report an Issue");
    await page.waitFor(`${DIALOG_OPEN} && ${DIALOG}.innerText.includes("Copy and open Discord")`, "written issue restored on reopen");

    // opening Discord copies it, shows toast, and keeps the written issue available
    await clickText(page, "button", "Copy and open Discord");
    await page.waitFor(statusToastShown("Issue copied", "Paste it into Discord."), "Issue copied toast");
    expect(await page.evaluate<boolean>(DIALOG_OPEN)).toBe(true);
    expect((await shell.host({ cmd: "issue-report-state" })).openedLinks).toEqual([{ reportId: firstId, index: 0 }]);

    // Start over returns to describe; a signed-in GitHub send files, resets and closes
    await clickText(page, "button", "Start over");
    await page.waitFor(`!!${DIALOG}.querySelector("textarea")`, "returned to describe");
    await clickText(page, "button", "Investigate");
    const secondId = await shell.host({ cmd: "issue-report-wait-start" });
    await shell.host({
        cmd: "issue-report-finish",
        result: {
            status: "written",
            title: "Game Server says Stopped after restart",
            body: "Verified cause in supervisor.go.",
            text: "Title: Game Server says Stopped after restart\n\nIssue Content:\nVerified cause in supervisor.go.",
            github: { repo: "MileniumHQ/Paperboard", state: "signed-in", login: "pxlkt" },
        },
    });
    await page.waitFor(`${DIALOG}.innerText.includes("File on GitHub")`, "written issue defaulting to GitHub");
    await clickText(page, "button", "File on GitHub");
    await page.waitFor(statusToastShown("Issue filed", "issues/999"), "Issue filed toast");
    await page.waitFor(DIALOG_CLOSED, "modal closed after GitHub file");
    expect((await shell.host({ cmd: "issue-report-state" })).filed).toEqual([secondId]);

    // reopening after GitHub file starts fresh with an empty description
    await clickText(page, "button", "Report an Issue");
    await page.waitFor(`${DIALOG_OPEN} && !!${DIALOG}.querySelector("textarea")`, "fresh describe form");
    expect(await page.evaluate<string>(`${DIALOG}.querySelector("textarea").value`)).toBe("");
    expect(page.exceptions).toEqual([]);
});
