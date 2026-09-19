import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";
import { createSignal } from "solid-js";

export default function PaperInterfaceGroupDoc() {
    const [tab, setTab] = createSignal("first");

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperInterfaceGroup</PaperText>
            <PaperText preset="body">
                PaperInterfaceGroup displays conditional view panels matching the active selected value.
                Reach for PaperInterfaceGroup when implementing tabbed content bodies, navigation switchers, or step containers.
                Each child item renders only when its value matches the group value.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass the active key string to PaperInterfaceGroup through the value prop.
                Declare child PaperInterfaceItem views with corresponding value keys.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import {
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperButton,
    PaperCard,
    PaperFlex,
    PaperText,
} from "@paperboard-dev/paperui";

export function Example() {
    const [tab, setTab] = createSignal("first");

    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full">
                <PaperButton
                    variant={tab() === "first" ? "primary" : undefined}
                    onClick={() => setTab("first")}
                >
                    First view
                </PaperButton>
                <PaperButton
                    variant={tab() === "second" ? "primary" : undefined}
                    onClick={() => setTab("second")}
                >
                    Second view
                </PaperButton>
            </PaperFlex>

            <PaperInterfaceGroup value={tab()}>
                <PaperInterfaceItem value="first" variant="plain">
                    <PaperText preset="body">Content of the first panel.</PaperText>
                </PaperInterfaceItem>
                <PaperInterfaceItem value="second" variant="plain">
                    <PaperText preset="body">Content of the second panel.</PaperText>
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="full">
                    <PaperButton
                        variant={tab() === "first" ? "primary" : undefined}
                        onClick={() => setTab("first")}
                    >
                        First view
                    </PaperButton>
                    <PaperButton
                        variant={tab() === "second" ? "primary" : undefined}
                        onClick={() => setTab("second")}
                    >
                        Second view
                    </PaperButton>
                </PaperFlex>

                <PaperInterfaceGroup value={tab()}>
                    <PaperInterfaceItem value="first" variant="plain">
                        <PaperText preset="body">Content of the first panel.</PaperText>
                    </PaperInterfaceItem>
                    <PaperInterfaceItem value="second" variant="plain">
                        <PaperText preset="body">Content of the second panel.</PaperText>
                    </PaperInterfaceItem>
                </PaperInterfaceGroup>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperInterfaceItem accepts layout variants for content hosting:
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
                            <td><PaperCode>value</PaperCode></td>
                            <td><PaperCode>string | number</PaperCode></td>
                            <td>No default</td>
                            <td>The matching key that determines when this item becomes active.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>variant</PaperCode></td>
                            <td><PaperCode>"page" | "full" | "centered" | "plain"</PaperCode></td>
                            <td><PaperCode>"page"</PaperCode></td>
                            <td>Hosting style: page (centered column), full (edge-to-edge), centered (flex center), plain (raw wrapper).</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Inactive items are unmounted from the DOM tree.
                The page variant wraps children in PaperPage to establish centered readability margins.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Use the full variant for terminal consoles and canvas boards that require raw viewport dimensions.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperInterfaceItem value="terminal" variant="full">
    <div style={{ width: "100%", height: "100%" }}>Terminal canvas</div>
</PaperInterfaceItem>`}
            </PaperCode>
        </PaperFlex>
    );
}
