import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const BUNFIG = `# Hermetic tests: test/hermetic.ts gives the whole test process a throwaway
# PAPERBOARD_DIR and replaces the WebSocket constructor, so no suite can reach
# a live daemon or your real Paperboard data. See test/hermetic.ts for why
# this matters.
[test]
preload = ["./test/hermetic.ts"]`;

const HERMETIC = `// Hermetic test guard: unit tests must never reach a live Paperboard.
// The panel SDK finds a running daemon through local/crane.json in the
// Paperboard data folder (PAPERBOARD_DIR, or ~/.paperboard), so on a dev
// machine with Paperboard live, a lazy transport connect reaches the REAL
// daemon: registrations CONFLICT with the live panel's socket and API calls
// return answers from real sessions. A test that passes offline and fails
// online is not a test. This preload gives the whole test process a
// throwaway data folder, and replaces the WebSocket constructor so any
// connect attempt fails immediately with this message, which makes every
// suite deterministic no matter what is running on the machine.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "panel-test-"));
process.env.PAPERBOARD_DIR = dataDir;
process.once("exit", () => rmSync(dataDir, { recursive: true, force: true }));

const original = globalThis.WebSocket;

class NoNetworkWebSocket {
    constructor() {
        throw new Error(
            "unit tests must not open network connections (a live daemon " +
                "would make test results environment-dependent); if a test " +
                "needs the wire, inject a stub transport instead",
        );
    }
}

// Keep the constant shape SDK code may inspect, without offering a socket.
(NoNetworkWebSocket as any).OPEN = original?.OPEN ?? 1;
(NoNetworkWebSocket as any).CONNECTING = original?.CONNECTING ?? 0;
(NoNetworkWebSocket as any).CLOSING = original?.CLOSING ?? 2;
(NoNetworkWebSocket as any).CLOSED = original?.CLOSED ?? 3;

(globalThis as any).WebSocket = NoNetworkWebSocket;`;

const UNIT_TEST = `import { describe, expect, it } from "bun:test";
import { cityName, currentWeatherUrl, dropsToFreezing, readCurrentWeather } from "../src/lib/openWeather";
import type { Forecast } from "../src/panel";

describe("cityName", () => {
    it("trims the name", () => {
        expect(cityName("  Oslo ")).toBe("Oslo");
    });

    it("refuses an empty name with a reason", () => {
        expect(() => cityName("   ")).toThrow("Enter a city name");
    });
});

describe("currentWeatherUrl", () => {
    it("encodes the city", () => {
        expect(currentWeatherUrl("São Paulo", "metric", "k")).toContain("q=S%C3%A3o+Paulo");
    });
});

describe("readCurrentWeather", () => {
    it("reads a forecast", () => {
        const body = { main: { temp: 4, temp_min: 1, temp_max: 6 }, weather: [{ description: "light rain" }] };
        expect(readCurrentWeather("Oslo", 200, body, 1000)).toEqual({
            city: "Oslo",
            temperature: 4,
            high: 6,
            low: 1,
            summary: "light rain",
            checkedAt: 1000,
        });
    });

    it("passes OpenWeather's own reason on", () => {
        expect(() => readCurrentWeather("Oslo", 401, { cod: 401, message: "Invalid API key." }, 0)).toThrow(
            "OpenWeather refused Oslo: Invalid API key.",
        );
    });

    it("refuses an answer with no temperature instead of showing zero", () => {
        expect(() => readCurrentWeather("Oslo", 200, { main: {} }, 0)).toThrow("without a temperature");
    });
});

describe("dropsToFreezing", () => {
    const reading = (temperature: number): Forecast => ({ city: "Oslo", temperature, high: temperature, low: temperature, summary: "snow", checkedAt: 0 });

    it("fires when the city drops to 0 °C", () => {
        expect(dropsToFreezing(reading(1), reading(0), "metric")).toBe(true);
    });

    it("stays quiet while the city stays frozen", () => {
        expect(dropsToFreezing(reading(-2), reading(-3), "metric")).toBe(false);
    });

    it("uses 32 °F in imperial units", () => {
        expect(dropsToFreezing(reading(33), reading(31), "imperial")).toBe(true);
    });
});`;

const E2E_TEST = `// Runs against a real Paperboard server daemon: the test one in E2E_PAPERBOARD_DIR,
// never your own. Start it, link this panel into it, then run:
//   E2E_PAPERBOARD_DIR=/tmp/weather-e2e bun test ./e2e/weather.e2e.ts
import { describe, expect, it } from "bun:test";

const dataDir = process.env.E2E_PAPERBOARD_DIR;
if (!dataDir) throw new Error("Set E2E_PAPERBOARD_DIR to the data folder of a test Paperboard");

function call(action: string, inputs: unknown) {
    const proc = Bun.spawnSync(["bunx", "paperapi", "call", "dev.example.weather", action, JSON.stringify(inputs)], {
        env: { ...process.env, PAPERBOARD_DIR: dataDir, NO_COLOR: "1" },
    });
    return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

describe("follow-city", () => {
    it("refuses a city it already follows, with the reason", () => {
        call("follow-city", { city: "Lima" });
        const again = call("follow-city", { city: "Lima" });
        expect(again.code).toBe(1);
        expect(again.stderr).toContain("Weather already follows Lima");
        call("unfollow-city", { city: "Lima" });
    });

    it("refuses an empty city before saving anything", () => {
        const empty = call("follow-city", { city: "  " });
        expect(empty.code).toBe(1);
        expect(empty.stderr).toContain("Enter a city name");
    });
});`;

export default function TestingGuideDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Test a panel</PaperText>
            <PaperText preset="body" as="p">
                A panel is tested in two ways: unit tests of its rules with no Paperboard running, and end-to-end tests against a test Paperboard.
                Neither ever reaches your own Paperboard or its data. This guide writes both for the Weather example panel.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                A panel made with <PaperCode>npm create @mileniumhq/panel</PaperCode>. Run every command from its folder.
                The end-to-end part needs a second Paperboard server daemon, as in <PaperLink href="/docs/guides/dev-loop/#test-paperboard">Work on a second Paperboard</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="what-you-get">What the scaffold gives you</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>File</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>bunfig.toml</PaperCode></td><td>Loads <PaperCode>test/hermetic.ts</PaperCode> before every test file.</td></tr>
                    <tr><td><PaperCode>test/hermetic.ts</PaperCode></td><td>Gives the test run a throwaway data folder and blocks every network connection.</td></tr>
                    <tr><td><PaperCode>test/uiStandards.test.ts</PaperCode></td><td>Fails on an inline style anywhere under <PaperCode>src/</PaperCode>, and on a <PaperCode>PaperModal</PaperCode> placed inside <PaperCode>Show</PaperCode> or a render callback.</td></tr>
                    <tr><td><PaperCode>test/greet.test.ts</PaperCode></td><td>Tests the template's greeting rules. Replace it with your panel's tests.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>bun test</PaperCode> runs every <PaperCode>*.test.ts</PaperCode> file. Keep the preload and the UI test as they are.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="real-data">Tests never reach your Paperboard</PaperText>
            <PaperText preset="body" as="p">
                Every PaperAPI client finds Paperboard through the data folder in <PaperCode>PAPERBOARD_DIR</PaperCode>, or <PaperCode>~/.paperboard</PaperCode> when it is not set.
                A test that ran against your own Paperboard would read and change your real panels, config and secrets, and its result would depend on what was running.
                The preload stops both:
            </PaperText>
            <PaperCode block language="text">{BUNFIG}</PaperCode>
            <PaperCode block language="tsx">{HERMETIC}</PaperCode>
            <PaperTextList>
                <li>Never remove the preload, and never set <PaperCode>PAPERBOARD_DIR</PaperCode> to your own data folder in a test.</li>
                <li>A test that needs a running Paperboard is an end-to-end test. It goes in its own folder, as below, and talks to a test Paperboard.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="unit-tests">Unit tests: the panel's rules</PaperText>
            <PaperText preset="body" as="p">
                Put the panel's rules in modules that import no PaperAPI and make no network calls, so a unit test reaches every one.
                Weather keeps them in <PaperCode>src/lib/openWeather.ts</PaperCode>, and the service only connects them to the network and the state.
                Its tests:
            </PaperText>
            <PaperCode block language="tsx">{UNIT_TEST}</PaperCode>
            <PaperTextList>
                <li>Test the failures as well as the results: the message is part of what the panel shows, so check its text.</li>
                <li>Test what the panel must never do, such as show zero for a reading it doesn't have.</li>
            </PaperTextList>
            <PaperCode block language="sh">
{`$ bun test
 11 pass
 0 fail
Ran 11 tests across 2 files.`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="prove-a-fix">Prove a fix</PaperText>
            <PaperText preset="body" as="p">
                Every fix comes with a test that fails without it. Write the test first, watch it fail, then fix the code.
                With <PaperCode>dropsToFreezing</PaperCode> cut down to <PaperCode>return after.temperature &lt;= limit;</PaperCode>, Weather's trigger would fire on every check while a city stays frozen. The test <PaperCode>stays quiet while the city stays frozen</PaperCode> catches it:
            </PaperText>
            <PaperCode block language="sh">
{`$ bun test
Expected: false
Received: true
(fail) dropsToFreezing > stays quiet while the city stays frozen
 10 pass
 1 fail`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Never skip, loosen or delete a failing test to make a run pass. When a test expects the wrong behavior, fix the test and say why in the change.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="end-to-end">End-to-end tests: a real Paperboard</PaperText>
            <PaperText preset="body" as="p">
                An end-to-end test calls the panel's actions through a test Paperboard, the same way flows and agents do.
                Weather's spawns <PaperCode>paperapi call</PaperCode> with <PaperCode>PAPERBOARD_DIR</PaperCode> set to the test Paperboard's data folder, taken from <PaperCode>E2E_PAPERBOARD_DIR</PaperCode>:
            </PaperText>
            <PaperCode block language="tsx">{E2E_TEST}</PaperCode>
            <PaperTextList>
                <li>The file is named <PaperCode>.e2e.ts</PaperCode>, so <PaperCode>bun test</PaperCode> alone does not run it. Run it by its path.</li>
                <li>It refuses to run without <PaperCode>E2E_PAPERBOARD_DIR</PaperCode>, so it can never fall back to your own data folder.</li>
                <li>The preload sets <PaperCode>PAPERBOARD_DIR</PaperCode> for the test process, so the test passes the test Paperboard's folder to each <PaperCode>paperapi call</PaperCode> itself.</li>
                <li>Each test undoes what it changed, so the tests can run in any order and again.</li>
            </PaperTextList>
            <PaperCode block language="sh">
{`# terminal 1: a test Paperboard
npx @mileniumhq/paperboard serve --headless --data-dir /tmp/weather-e2e --port 47815 --host 127.0.0.1

# terminal 2: the panel folder
PAPERBOARD_DIR=/tmp/weather-e2e bunx paperapi link
PAPERBOARD_DIR=/tmp/weather-e2e bunx paperapi restart
E2E_PAPERBOARD_DIR=/tmp/weather-e2e bun test ./e2e/weather.e2e.ts`}
            </PaperCode>
            <PaperCode block language="sh">
{` 2 pass
 0 fail
Ran 2 tests across 1 file.`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="by-hand">Check it by hand</PaperText>
            <PaperText preset="body" as="p">
                Tests don't show how the panel looks. Before you ship, open every page and widget in Paperboard, in the light and the dark theme and in a narrow window, and make every failure happen once.
                The <PaperLink href="/docs/guides/checklist/">panel checklist</PaperLink> lists what to look at.
            </PaperText>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/guides/checklist/">the panel checklist</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
