import {
    PaperCode,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">Quick start</PaperText>
            <PaperText preset="body">
                A guide to creating an empty Paperboard panel from scratch, wired with PaperUI for the interface and PaperAPI for host access.
            </PaperText>
            <PaperSeparator />

            <PaperText id="prerequisites" preset="subheader">
                Prerequisites
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    Bun (or Node 18 or later) with a package manager.
                </PaperText>
                <PaperText preset="body">
                    A Vite-based SolidJS project, or a new empty directory to create one in.
                </PaperText>
            </PaperTextList>

            <PaperSeparator />

            <PaperText id="project-setup" preset="subheader">
                Project setup
            </PaperText>
            <PaperText preset="body">
                Scaffold a Solid + TypeScript project and add both libraries:
            </PaperText>
            <PaperCode block language="bash">
                {`bun create vite@latest my-panel -- --template solid-ts
cd my-panel
bun install paperapi paperui`}
            </PaperCode>

            <PaperText id="entrypoint" preset="subheader">
                Entrypoint
            </PaperText>
            <PaperText preset="body">
                Import the PaperUI stylesheet, wrap the application in a provider, and render something. The file below is a complete <PaperCode>src/index.tsx</PaperCode>:
            </PaperText>
            <PaperCode block language="tsx">
                {`/* @refresh reload */
import { render } from "solid-js/web";
import { PaperProvider, PaperButton, PaperText } from "@paperboard-dev/paperui";
import "@paperboard-dev/paperui/style.css";
import { invoke } from "@paperboard-dev/paperapi";

function App() {
    const ping = async () => {
        // Resolves only when running inside Paperboard
        try {
            await process.start({
                id: "hello",
                command: "echo",
                args: ["Hello from my panel"],
            });
        } catch {
            console.warn("Not running inside Paperboard");
        }
    };

    return (
        <PaperProvider theme="system" styleBody>
            <PaperText preset="header">My panel</PaperText>
            <PaperButton onClick={ping}>Run</PaperButton>
        </PaperProvider>
    );
}

render(() => <App />, document.getElementById("root")!);`}
            </PaperCode>

            <PaperQuote variant="yellow" icon="warning" title="Host availability">
                API calls reject outside Paperboard. Guard them, as above, so the panel still renders during browser development.
            </PaperQuote>

            <PaperSeparator />

            <PaperText id="manifest" preset="subheader">
                Panel manifest
            </PaperText>
            <PaperText preset="body">
                Every panel requires a <PaperCode>manifest.json</PaperCode> at the repository root. The <PaperCode>id</PaperCode> must be a reverse-domain identifier of at least three segments:
            </PaperText>
            <PaperCode block language="json">
                {`{
    "id": "dev.example.mypanel",
    "name": "My panel",
    "version": "0.1.0",
    "description": "A minimal Paperboard panel.",
    "base": "./dist/index.html"
}`}
            </PaperCode>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Required</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>id</PaperCode></td>
                        <td>Yes</td>
                        <td>Reverse-domain identifier matching <PaperCode>host.app.panel</PaperCode>; also used as the storage key for files and configuration.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>name</PaperCode></td>
                        <td>Yes</td>
                        <td>Display name shown in the library.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>version</PaperCode></td>
                        <td>No</td>
                        <td>Semantic version; defaults to 1.0.0.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td>No</td>
                        <td>Short summary shown in the library.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>base</PaperCode></td>
                        <td>No</td>
                        <td>Entry HTML path relative to the archive root; defaults to ./dist/index.html.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td>No</td>
                        <td>Path to an icon image inside the archive.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="dev-loop" preset="subheader">
                Development loop
            </PaperText>
            <PaperText preset="body">
                Build the panel, then link the repository into Paperboard's development mode. The panel appears in the library immediately and reloads from source on each rebuild — no packaging required:
            </PaperText>
            <PaperCode block language="bash">
                {`bun run build
bunx paperapi link`}
            </PaperCode>
            <PaperText preset="body">
                When finished, remove the development link with <PaperCode>bunx paperapi unlink dev.example.mypanel</PaperCode>. The CLI reference covers every command.
            </PaperText>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperapi/overview">CLI</PaperLink> — Link, unlink, and pack commands.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/quick-start">PaperUI quick start</PaperLink> — Component usage basics.
                </PaperText>
            </PaperTextList>
        </>
    );
}
