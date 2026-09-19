import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperInput,
    PaperText,
} from "@paperboard-dev/paperui";

export default function QuickstartDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Quick start</PaperText>
            <PaperText preset="body">
                This guide sets up PaperUI in a standalone SolidJS application.
                Reach for this workflow when building independent web tools that do not run inside Paperboard panels.
                The process requires installing the package, importing the global stylesheet, and mounting PaperProvider.
            </PaperText>

            <PaperText preset="subheader" id="installation">Installation</PaperText>
            <PaperText preset="body">
                Install the package alongside SolidJS using your preferred package manager.
            </PaperText>
            <PaperCode block language="bash">
{`bun add @paperboard-dev/paperui solid-js`}
            </PaperCode>
            <PaperText preset="body">
                With npm:
            </PaperText>
            <PaperCode block language="bash">
{`npm install @paperboard-dev/paperui solid-js`}
            </PaperCode>

            <PaperText preset="subheader" id="importing-styles">Importing styles</PaperText>
            <PaperText preset="body">
                Import the stylesheet in your client entry file before rendering components.
                This stylesheet registers design tokens, fonts, and animation variables.
            </PaperText>
            <PaperCode block language="tsx">
{`import "@paperboard-dev/paperui/style.css";`}
            </PaperCode>

            <PaperText preset="subheader" id="root-provider">Root provider</PaperText>
            <PaperText preset="body">
                Mount PaperProvider around your view hierarchy.
                The provider establishes the CSS custom property scope and detects theme changes.
            </PaperText>
            <PaperCode block language="tsx">
{`import { render } from "solid-js/web";
import { PaperProvider, PaperFlex, PaperText } from "@paperboard-dev/paperui";
import "@paperboard-dev/paperui/style.css";

function App() {
    return (
        <PaperProvider theme="system" styleBody fullScreen>
            <PaperFlex direction="column" gap="double" padding="double">
                <PaperText preset="title">Application</PaperText>
            </PaperFlex>
        </PaperProvider>
    );
}

render(() => <App />, document.getElementById("root")!);`}
            </PaperCode>

            <PaperText preset="subheader" id="interactive-sample">Interactive sample</PaperText>
            <PaperText preset="body">
                Combine input and action components within a container card.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperButton, PaperCard, PaperFlex, PaperInput, PaperText } from "@paperboard-dev/paperui";

export function SearchCard() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column" gap="full">
                <PaperText weight={600}>Search</PaperText>
                <PaperInput placeholder="Filter records" fullWidth />
                <PaperButton variant="primary">Submit</PaperButton>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="full">
                    <PaperText weight={600}>Search</PaperText>
                    <PaperInput placeholder="Filter records" fullWidth />
                    <PaperButton variant="primary">Submit</PaperButton>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="build-settings">Build settings</PaperText>
            <PaperText preset="body">
                Vite bundles PaperUI directly through standard ES module resolution.
                No custom Babel transforms or CSS preprocessors are required.
            </PaperText>
        </PaperFlex>
    );
}
