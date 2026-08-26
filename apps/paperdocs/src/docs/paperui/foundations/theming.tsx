import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
    usePaper,
} from "@paperboard-dev/paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [demoTheme, setDemoTheme] = createSignal<"dark" | "light">("dark");

    const toggleDemo = () => {
        setDemoTheme(demoTheme() === "dark" ? "light" : "dark");
    };

    return (
        <>
            <PaperText preset="header">Theming</PaperText>
            <PaperText preset="body">
                The theming architecture of PaperUI, including dynamic theme modes, system preference detection, DOM attribute binding, and runtime context utilities.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperUI theming</strong> operates through the declaration of the <PaperCode>data-paperui-theme</PaperCode> attribute on the root HTML element or container boundary. The system supports three distinct operational modes: <PaperCode>"light"</PaperCode>, <PaperCode>"dark"</PaperCode>, and <PaperCode>"system"</PaperCode>.
            </PaperText>

            <PaperSeparator />

            <PaperText id="theme-modes" preset="subheader">
                Theme Modes and Resolution
            </PaperText>
            <PaperText preset="body">
                When configured to <PaperCode>"system"</PaperCode>, PaperUI subscribes to the browser's <PaperCode>window.matchMedia("(prefers-color-scheme: dark)")</PaperCode> event stream. When the operating system theme transitions, the active theme updates reactively without requiring a page reload.
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Theme Mode</th>
                        <th>Resolved Attribute</th>
                        <th>Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>"system"</PaperCode></td>
                        <td><PaperCode>"dark"</PaperCode> or <PaperCode>"light"</PaperCode></td>
                        <td>Tracks operating system preference via <PaperCode>prefers-color-scheme</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"dark"</PaperCode></td>
                        <td><PaperCode>"dark"</PaperCode></td>
                        <td>Forces dark background surfaces and high-contrast light typography.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"light"</PaperCode></td>
                        <td><PaperCode>"light"</PaperCode></td>
                        <td>Forces light background surfaces and dark typography.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="interactive-theming" preset="subheader">
                Interactive Container Isolation
            </PaperText>
            <PaperText preset="body">
                Theme contexts may be nested. An individual container or dialog subtree can enforce a specific theme independently of the ambient global theme by setting <PaperCode>data-paperui-theme</PaperCode>:
            </PaperText>

            <PaperCode block language="tsx">
                {`// Toggle theme on an isolated preview container
const [theme, setTheme] = createSignal<"dark" | "light">("dark");

<div data-paperui-theme={theme()}>
    <PaperContainer>
        <PaperText preset="title">Scoped Theme Node</PaperText>
    </PaperContainer>
</div>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="full" center>
                    <div
                        data-paperui-theme={demoTheme()}
                        style={{
                            width: "100%",
                            padding: "var(--paper-uigap)",
                            "border-radius": "var(--paper-border-radius)",
                            background: "var(--paper-background-backest)",
                            color: "var(--paper-main-text)",
                            border: "1px solid var(--paper-medium-border)",
                        }}
                    >
                        <PaperFlex gap="half" center>
                            <PaperText preset="title">Scoped Theme: {demoTheme().toUpperCase()}</PaperText>
                            <PaperText preset="body">
                                This container is isolated and dynamically inherits the <PaperCode>{demoTheme()}</PaperCode> token values.
                            </PaperText>
                            <PaperButton variant="blue" onClick={toggleDemo}>
                                Switch Scoped Theme
                            </PaperButton>
                        </PaperFlex>
                    </div>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="theme-utilities" preset="subheader">
                Theme Context Hook (<PaperCode>usePaper</PaperCode>)
            </PaperText>
            <PaperText preset="body">
                Child components encapsulated within <PaperLink href="/paperui/paperprovider"><PaperCode>PaperProvider</PaperCode></PaperLink> can access and modify the current theme mode via the <PaperCode>usePaper()</PaperCode> hook:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { usePaper } from "@paperboard-dev/paperui";

function ThemeController() {
    const paper = usePaper();

    return (
        <PaperButton onClick={() => paper?.setTheme("dark")}>
            Current Mode: {paper?.theme()}
        </PaperButton>
    );
}`}
            </PaperCode>

            <PaperSeparator />

            <PaperText id="text-selection" preset="subheader">
                Text Selection Behavior & Utilities
            </PaperText>
            <PaperText preset="body">
                PaperUI preserves normal text selection by default across websites and documentation. When building desktop applications or embedded panel frames, non-selectable chrome behavior can be enabled on-demand using classes or attributes:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Class / Attribute</th>
                        <th>Target</th>
                        <th>Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>.unselectable</PaperCode> / <PaperCode>[data-unselectable="true"]</PaperCode></td>
                        <td>Container / Root</td>
                        <td>Applies <PaperCode>user-select: none</PaperCode> across chrome while maintaining selection in inputs, textareas, and code blocks.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>.selectable</PaperCode> / <PaperCode>[data-selectable="true"]</PaperCode></td>
                        <td>Specific Element</td>
                        <td>Forces <PaperCode>user-select: text</PaperCode> on targeted content inside an unselectable container.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperprovider">PaperProvider</PaperLink> — Application root provider component reference and unselectable prop.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/colors">Colors</PaperLink> — Specification of theme-adaptive surface and text colors.
                </PaperText>
            </PaperTextList>
        </>
    );
}
