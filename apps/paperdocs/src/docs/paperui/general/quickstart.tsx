import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperUiQuickstartDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Quick start</PaperText>
            <PaperText preset="body" as="p">
                This page builds the smallest complete PaperUI panel: a provider, a menu, two pages, and a confirm dialog.
                You end with a panel that looks like the rest of Paperboard in light and dark, with no CSS written.
                It assumes a scaffolded panel; the scaffold is the quickest way to get the build set up.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperTextList>
                <li>Bun or Node with npm, and Paperboard installed. See <PaperLink href="/docs/paperboard/install/">Install Paperboard</PaperLink>.</li>
                <li>A basic knowledge of SolidJS: signals, <PaperCode>Show</PaperCode>, and JSX. PaperUI components are Solid components.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="scaffold">Scaffold a panel</PaperText>
            <PaperText preset="body" as="p">
                Run the generator and answer its prompts.
                It writes a folder with the Vite config, the manifest, tests and a working three-page panel.
                The full walkthrough is in <PaperLink href="/docs/developers/first-panel/">Your first panel</PaperLink>.
            </PaperText>
            <PaperCode block language="sh">
{`npm create @mileniumhq/panel`}
            </PaperCode>
            <PaperText preset="body" as="p">
                To add PaperUI to a Solid and Vite project you already have, install it with Solid as a peer:
            </PaperText>
            <PaperCode block language="sh">
{`npm install @mileniumhq/paperui solid-js`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Use <PaperCode>vite-plugin-solid</PaperCode> in the Vite config and let TypeScript compile Solid JSX.
                These are the settings the panel template uses:
            </PaperText>
            <PaperCode block language="ts">
{`// vite.config.ts
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [solidPlugin()],
    resolve: {
        dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
    },
});`}
            </PaperCode>{" "}
            <PaperCode block language="json">
{`{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "noEmit": true,
    "isolatedModules": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="entry">The entry file</PaperText>
            <PaperText preset="body" as="p">
                A panel is its own document, so it mounts its own provider.{" "}
                <PaperLink href="/docs/paperui/paperprovider/">PaperProvider</PaperLink> sets the theme and the rules that scope PaperUI's scrollbars, selection and disabled styling.
                Import <PaperCode>style.css</PaperCode> for the tokens and fonts, and <PaperCode>panel.css</PaperCode> for the document reset.
                The page needs a mount element with the id <PaperCode>app</PaperCode>.
            </PaperText>
            <PaperCode block language="html">
{`<!-- index.html -->
<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>My panel</title>
    </head>
    <body>
        <div id="app"></div>
        <script type="module" src="/src/index.tsx"></script>
    </body>
</html>`}
            </PaperCode>{" "}
            <PaperCode block language="tsx">
{`// src/index.tsx
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import App from "./App";

const root = document.getElementById("app");
if (!root) throw new Error("The #app element is missing from index.html");

render(
    () => (
        <PaperProvider fullWidth fullHeight>
            <App />
        </PaperProvider>
    ),
    root,
);`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>fullWidth</PaperCode> and <PaperCode>fullHeight</PaperCode> make the provider fill the window, which gives <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink> the height it needs.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="shell">The panel shell</PaperText>
            <PaperText preset="body" as="p">
                <PaperLink href="/docs/paperui/paperpanel/">PaperPanel</PaperLink> holds a <PaperLink href="/docs/paperui/papermenu/">PaperMenu</PaperLink> and a <PaperLink href="/docs/paperui/paperinterfacegroup/">PaperInterfaceGroup</PaperLink>.
                One signal holds the current page: the menu writes it and the group reads it.
                Each page is an interface item.
                On a narrow window the panel turns the menu into the first screen and slides pages over it, so you write nothing for phones.
            </PaperText>
            <PaperCode block language="tsx">
{`// src/App.tsx
import { createSignal } from "solid-js";
import {
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperMenu,
    PaperMenuItem,
    PaperPanel,
} from "@mileniumhq/paperui";
import CounterPage from "./pages/CounterPage";
import AboutPage from "./pages/AboutPage";

export default function App() {
    const [page, setPage] = createSignal("counter");

    return (
        <PaperPanel>
            <PaperMenu name="panel-menu" value={page()} onValueChange={(value) => setPage(String(value))}>
                <PaperMenuItem value="counter" icon="add">Counter</PaperMenuItem>
                <PaperMenuItem value="about" icon="info">About</PaperMenuItem>
            </PaperMenu>

            <PaperInterfaceGroup value={page()}>
                <PaperInterfaceItem value="counter">
                    <CounterPage />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="about">
                    <AboutPage />
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        </PaperPanel>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="pages">Two pages</PaperText>
            <PaperText preset="body" as="p">
                An interface item wraps its content in a <PaperLink href="/docs/paperui/paperpage/">PaperPage</PaperLink>: a centered, padded column that scrolls.
                A page starts with a <PaperLink href="/docs/paperui/paperpageheader/">PaperPageHeader</PaperLink>, then cards.
            </PaperText>
            <PaperCode block language="tsx">
{`// src/pages/AboutPage.tsx
import { PaperCard, PaperFlex, PaperPageHeader, PaperText } from "@mileniumhq/paperui";

export default function AboutPage() {
    return (
        <>
            <PaperPageHeader icon="info" title="About" />
            <PaperCard>
                <PaperFlex direction="column" padding="double" gap="half">
                    <PaperText preset="label">Panel</PaperText>
                    <PaperText preset="hint">Built from PaperUI components and props only.</PaperText>
                </PaperFlex>
            </PaperCard>
        </>
    );
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                The counter page adds state, the main action wrapped in <PaperLink href="/docs/paperui/papereffect/">PaperEffect</PaperLink>, and a confirm dialog.
            </PaperText>
            <PaperCode block language="tsx">
{`// src/pages/CounterPage.tsx
import { createSignal } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperPageHeader,
    PaperText,
} from "@mileniumhq/paperui";

export default function CounterPage() {
    const [count, setCount] = createSignal(0);
    const [confirmOpen, setConfirmOpen] = createSignal(false);

    function reset() {
        setCount(0);
        setConfirmOpen(false);
    }

    return (
        <>
            <PaperPageHeader icon="add" title="Counter" subtitle="State that lives in this window">
                <PaperButton variant="text" onClick={() => setConfirmOpen(true)}>Reset</PaperButton>
            </PaperPageHeader>

            <PaperCard>
                <PaperFlex direction="column" padding="double" gap="full" align="center">
                    <PaperText preset="headline" as="p">{count()}</PaperText>
                    <PaperEffect variant="primary">
                        <PaperButton variant="primary" onClick={() => setCount(count() + 1)}>
                            <PaperIcon>add</PaperIcon>
                            Add one
                        </PaperButton>
                    </PaperEffect>
                </PaperFlex>
            </PaperCard>

            <PaperModal
                open={confirmOpen()}
                onClose={() => setConfirmOpen(false)}
                title="Reset the counter"
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setConfirmOpen(false)}>Cancel</PaperButton>
                        <PaperButton variant="primary" onClick={reset}>Reset</PaperButton>
                    </>
                }
            >
                <PaperText preset="body" as="p">The count goes back to 0.</PaperText>
            </PaperModal>
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="rules">What makes it look like Paperboard</PaperText>
            <PaperText preset="body" as="p">
                The panel has no stylesheet of its own.
                Five habits do the work, and the sample follows each:
            </PaperText>
            <PaperTextList>
                <li>PaperUI only. Layout is <PaperLink href="/docs/paperui/paperflex/">PaperFlex</PaperLink> and <PaperLink href="/docs/paperui/papercard/">PaperCard</PaperLink>, text is <PaperLink href="/docs/paperui/papertext/">PaperText</PaperLink>, and actions are <PaperLink href="/docs/paperui/paperbutton/">PaperButton</PaperLink>. There is no raw <PaperCode>div</PaperCode> with a class.</li>
                <li>No inline styles and no static values. Spacing, size and color come from props that take tokens: <PaperCode>padding="double"</PaperCode>, <PaperCode>gap="half"</PaperCode>, <PaperCode>variant="primary"</PaperCode>. Never write a pixel or rem value. When a token has to appear in code, call <PaperCode>getVarCss("primary")</PaperCode>, never a raw <PaperCode>var(--paper-primary)</PaperCode>.</li>
                <li>Modals stay mounted. The modal is always rendered and driven by <PaperCode>open</PaperCode>, never wrapped in <PaperCode>Show</PaperCode>, so it animates out and releases focus properly.</li>
                <li>Sizes are tokens. <PaperCode>size="small"</PaperCode> on the modal and <PaperCode>width="field"</PaperCode> on a flex name a size. See <PaperLink href="/docs/paperui/spacing/">Spacing and layout</PaperLink>.</li>
                <li>Cancel is a text button. Next to a confirm that is not destructive, Cancel is <PaperCode>variant="text"</PaperCode> so the confirm is the clear choice. A destructive confirm uses <PaperCode>variant="danger"</PaperCode>.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Failures are shown, never swallowed: a handler that can fail catches the error and renders it with <PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink> where the result would have been.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="run">Build and open it</PaperText>
            <PaperText preset="body" as="p">
                From the scaffolded folder, build the panel and link it so Paperboard runs it from there.
                After a change, build again and restart the panel.
            </PaperText>
            <PaperCode block language="sh">
{`bun install
bun run build
bunx paperapi link`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Paperboard runs the panel from that folder.
                The panel takes the theme of the window it opens in, because the provider reads it from the document.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="next">Next</PaperText>
            <PaperTextList>
                <li><PaperLink href="/docs/developers/ui/">Building a good panel UI</PaperLink> teaches layout, states, and feedback.</li>
                <li><PaperLink href="/docs/paperui/design-language/">Design language</PaperLink> explains the surfaces, borders, color roles and shadow the panel is drawn with.</li>
                <li><PaperLink href="/docs/paperapi/overview/">PaperAPI</PaperLink> gives the panel files, secrets, processes and a background service.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
