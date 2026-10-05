import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperProviderDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperProvider</PaperText>
            <PaperText preset="body">
                PaperProvider manages the root theme context, body attributes, and system appearance listeners.
                Reach for PaperProvider at the root of every PaperUI application or isolated component tree.
                The provider injects theme dataset markers, synchronizes dark mode preferences, and exports the usePaper hook.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Wrap the application tree in PaperProvider at your top-level mount point.
                Specify theme="system" to synchronize automatically with the host system theme.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperProvider, PaperCard, PaperText } from "@mileniumhq/paperui";

export function App() {
    return (
        <PaperProvider theme="system" styleBody fullScreen>
            <PaperCard padding="double" surface="front">
                <PaperText preset="body">Application running within PaperProvider.</PaperText>
            </PaperCard>
        </PaperProvider>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperText preset="body">Application running within PaperProvider.</PaperText>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperProvider accepts the following configuration properties:
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
                            <td>Appearance mode. When set to system, resolves from the OS or host frame.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>styleBody</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Syncs data-paperui-theme and background styling directly onto document.body.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>fullScreen</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Sets container width to 100vw and height to 100vh.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>scrollable</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Enables vertical scroll overflow on the provider root.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>unselectable</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Applies user-select: none to application chrome while preserving input text selection.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Child components consume theme context using the usePaper hook.
                Calling setTheme switches the theme reactively across all descendant surfaces.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Toggle themes programmatically using usePaper.
            </PaperText>
            <PaperCode block language="tsx">
{`import { usePaper, PaperButton } from "@mileniumhq/paperui";

export function ThemeToggle() {
    const paper = usePaper();
    return (
        <PaperButton onClick={() => paper?.setTheme(paper.theme() === "dark" ? "light" : "dark")}>
            Toggle theme
        </PaperButton>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
