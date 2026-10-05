import {
    PaperCard,
    PaperChip,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperChipDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperChip</PaperText>
            <PaperText preset="body">
                PaperChip renders a compact toggle pill for filters, view switches, and scopes.
                Reach for PaperChip when a set of options can be toggled on and off and the counts matter.
                The chip renders a real button and reports its toggled state through aria-pressed.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass the label as children and drive the selected state with the selected prop.
                An optional count renders as a trailing figure, and an optional icon leads the label.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperChip, PaperCard, PaperFlex } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="half" wrap>
                <PaperChip selected count={3}>Online</PaperChip>
                <PaperChip selected count={12}>Whitelisted</PaperChip>
                <PaperChip count={1} icon="block">Banned</PaperChip>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="half" wrap>
                    <PaperChip selected count={3}>Online</PaperChip>
                    <PaperChip selected count={12}>Whitelisted</PaperChip>
                    <PaperChip count={1} icon="block">Banned</PaperChip>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperChip accepts toggle and content properties alongside standard button attributes.
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
                            <td><PaperCode>selected</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Toggled state. Tints the pill and sets aria-pressed.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>count</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Trailing count shown beside the label. Omitted when undefined.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>icon</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Leading icon rendered before the label. String values render via PaperIcon.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>disabled</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Disables the control and removes it from interaction.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperChip renders a button with type="button" by default, so it never submits a surrounding form.
                The selected state is exposed as a string aria-pressed value for assistive devices.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Use a row of chips as a filter bar; pair each chip with the count of matching items.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="half" wrap>
    <PaperChip selected={showOnline} count={onlineCount} onClick={() => setShowOnline(!showOnline)}>
        Online
    </PaperChip>
    <PaperChip selected={showOp} count={opCount} onClick={() => setShowOp(!showOp)}>
        OP
    </PaperChip>
</PaperFlex>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperFlex direction="row" gap="half" wrap>
                    <PaperChip selected count={2}>Online</PaperChip>
                    <PaperChip count={2} icon="shield_person">OP</PaperChip>
                </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
