import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">Quick start</PaperText>
            <PaperText preset="body">
                Step-by-step procedures for installing, configuring, and bootstrapping a SolidJS application with the PaperUI component library.
            </PaperText>
            <PaperSeparator />

            <PaperText id="prerequisites" preset="subheader">
                Prerequisites
            </PaperText>
            <PaperText preset="body">
                PaperUI requires <PaperLink href="https://nodejs.org/" external>Node.js</PaperLink> (version 18 or newer) or <PaperLink href="https://bun.sh/" external>Bun</PaperLink>, alongside a <PaperLink href="https://docs.solidjs.com/" external>SolidJS</PaperLink> project initialized with <PaperLink href="https://vitejs.dev/" external>Vite</PaperLink> or an equivalent module bundler.
            </PaperText>

            <PaperSeparator />

            <PaperText id="installation" preset="subheader">
                Installation
            </PaperText>
            <PaperText preset="body">
                PaperUI is distributed via the standard npm registry. The package and its peer dependency (<PaperCode>solid-js</PaperCode>) can be installed using any standard JavaScript package manager:
            </PaperText>

            <PaperText id="npm" preset="title">
                Using npm
            </PaperText>
            <PaperCode block language="bash">
                npm install @paperboard-dev/paperui solid-js
            </PaperCode>

            <PaperText id="bun" preset="title">
                Using Bun
            </PaperText>
            <PaperCode block language="bash">
                bun add @paperboard-dev/paperui solid-js
            </PaperCode>

            <PaperText id="pnpm" preset="title">
                Using pnpm
            </PaperText>
            <PaperCode block language="bash">
                pnpm add @paperboard-dev/paperui solid-js
            </PaperCode>

            <PaperSeparator />

            <PaperText id="stylesheet-integration" preset="subheader">
                Stylesheet integration
            </PaperText>
            <PaperText preset="body">
                PaperUI relies on global CSS custom properties for color theming, elevation, typography, and standard element resets. The stylesheet must be imported once in the application's root entrypoint (such as <PaperCode>index.tsx</PaperCode> or <PaperCode>main.tsx</PaperCode>):
            </PaperText>

            <PaperCode block language="tsx">
                {`import "@paperboard-dev/paperui/style.css";`}
            </PaperCode>

            <PaperQuote variant="blue" icon="font_download" title="Integrated fonts">
                Importing <PaperCode>@paperboard-dev/paperui/style.css</PaperCode> automatically declares and loads the requisite font assets: Nunito (display/rounded), Nunito Sans (body), SUSE Mono (code), and Google's Material Symbols Rounded icon font.
            </PaperQuote>

            <PaperSeparator />

            <PaperText id="root-provider-setup" preset="subheader">
                Root provider setup
            </PaperText>
            <PaperText preset="body">
                The top-level component tree must be encapsulated within <PaperLink href="/paperui/paperprovider"><PaperCode>PaperProvider</PaperCode></PaperLink>. This component initializes the theme context, observes system color scheme preferences, applies the <PaperCode>data-paperui-theme</PaperCode> attribute, and provides standard viewport styling.
            </PaperText>

            <PaperCode block language="tsx">
                {`import { render } from "solid-js/web";
import { PaperProvider, PaperFlex, PaperButton, PaperText } from "@paperboard-dev/paperui";
import "@paperboard-dev/paperui/style.css";

function App() {
    return (
        <PaperFlex padding="double" gap="full" center>
            <PaperText preset="header">Application Initialized</PaperText>
            <PaperText preset="body">
                PaperUI components are now active and ready for development.
            </PaperText>
            <PaperButton variant="brand" onClick={() => alert("Action triggered")}>
                Get Started
            </PaperButton>
        </PaperFlex>
    );
}

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
                    <PaperText preset="title">Live bootstrap preview</PaperText>
                    <PaperText preset="body">
                        The container below exemplifies an initialized PaperUI application node:
                    </PaperText>
                    <PaperContainer>
                        <PaperFlex padding="double" gap="half" center>
                            <PaperText preset="header">Application Initialized</PaperText>
                            <PaperText preset="body">PaperUI components are active.</PaperText>
                        </PaperFlex>
                    </PaperContainer>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperprovider">PaperProvider</PaperLink> — Full reference for provider props and theme options.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperflex">PaperFlex</PaperLink> — Structural flex container and resizable layout engine.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/theming">Theming</PaperLink> — Detailed documentation on system, dark, and light modes.
                </PaperText>
            </PaperTextList>
        </>
    );
}
