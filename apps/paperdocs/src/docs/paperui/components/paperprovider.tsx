import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperProvider,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
    usePaper,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperProvider</PaperText>
            <PaperText preset="body">
                <strong>PaperProvider</strong> is the root context provider component of PaperUI responsible for theme resolution, system color-scheme observation, body attribute synchronization, and layout constraint classes.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperProvider</strong> encapsulates the application component tree to establish PaperUI design system context. It automatically subscribes to browser <PaperCode>prefers-color-scheme</PaperCode> changes, applies the <PaperCode>data-paperui-theme</PaperCode> attribute, applies global font-family resets, and provides the <PaperCode>usePaper()</PaperCode> hook for dynamic theme toggling.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and Demonstration
            </PaperText>
            <PaperText preset="body">
                Applications bootstrap by mounting <PaperCode>PaperProvider</PaperCode> at the application root:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { render } from "solid-js/web";
import { PaperProvider } from "@paperboard-dev/paperui";
import "@paperboard-dev/paperui/style.css";
import App from "./App";

render(
    () => (
        <PaperProvider theme="system" styleBody fullScreen>
            <App />
        </PaperProvider>
    ),
    document.getElementById("root")!
);`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="half" center>
                    <PaperText preset="title">Provider Demonstration</PaperText>
                    <PaperText preset="body">
                        The current documentation application is rendered inside an active <PaperCode>PaperProvider</PaperCode> context.
                    </PaperText>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="context-hook" preset="subheader">
                Theme Context Hook (<PaperCode>usePaper</PaperCode>)
            </PaperText>
            <PaperText preset="body">
                Any descendant component within <PaperCode>PaperProvider</PaperCode> can read and alter the active theme:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { usePaper, PaperButton } from "@paperboard-dev/paperui";

function ThemeSwitcher() {
    const paper = usePaper();

    return (
        <PaperButton onClick={() => paper?.setTheme("dark")}>
            Active Theme: {paper?.theme()}
        </PaperButton>
    );
}`}
            </PaperCode>

            <PaperSeparator />

            <PaperText id="selection-control" preset="subheader">
                Text Selection Control
            </PaperText>
            <PaperText preset="body">
                By default, PaperUI leaves standard browser text selection enabled so that web applications, documentation portals, and content pages remain fully selectable. For desktop applications (such as Paperboard) and panel windows where a native, non-highlightable chrome is desired, pass the <PaperCode>unselectable</PaperCode> (or <PaperCode>noSelect</PaperCode>) prop:
            </PaperText>

            <PaperCode block language="tsx">
                {`// Enables native desktop app unselectable chrome
<PaperProvider theme="system" styleBody unselectable fullScreen>
    <DesktopApp />
</PaperProvider>`}
            </PaperCode>

            <PaperText preset="body">
                Even when <PaperCode>unselectable</PaperCode> is active on the provider, user-editable inputs, textareas, code blocks, and elements marked with <PaperCode class="selectable">.selectable</PaperCode> automatically retain text selection.
            </PaperText>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical Specification
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>theme</PaperCode></td>
                        <td><PaperCode>"light" | "dark" | "system"</PaperCode></td>
                        <td><PaperCode>"system"</PaperCode></td>
                        <td>Initial theme mode or controlled theme state.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>styleBody</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Applies <PaperCode>data-paperui-theme</PaperCode> directly to the HTML <PaperCode>&lt;body&gt;</PaperCode> element.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>unselectable</PaperCode> / <PaperCode>noSelect</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Disables text selection across root chrome while preserving selection in inputs, textareas, and code blocks.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullScreen</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Constrains the container to exactly <PaperCode>100vw</PaperCode> and <PaperCode>100vh</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullWidth</PaperCode> / <PaperCode>fullHeight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Expands the provider container to 100vw or 100vh respectively.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>scrollable</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Enables vertical scroll overflow on the root container.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/theming">Theming</PaperLink> — Comprehensive overview of theme modes and token inheritance.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/quick-start">Quick Start</PaperLink> — Initial setup instructions using PaperProvider.
                </PaperText>
            </PaperTextList>
        </>
    );
}
