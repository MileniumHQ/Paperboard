import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperKeyValue,
    PaperKeyValueList,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperKeyValueListDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperKeyValueList</PaperText>
            <PaperText preset="body">
                PaperKeyValueList formats paired label and value rows for property readouts and system statistics.
                Reach for PaperKeyValueList when displaying hardware metrics, network addresses, or metadata ledgers.
                The list aligns terms and definitions using semantic definition list markup.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Wrap PaperKeyValue items inside PaperKeyValueList.
                Pass term descriptions through the label prop and definitions as children.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperKeyValueList, PaperKeyValue, PaperCard } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperKeyValueList>
                <PaperKeyValue label="Hostname">paperboard.local</PaperKeyValue>
                <PaperKeyValue label="Version">3.0.0-alpha</PaperKeyValue>
                <PaperKeyValue label="Status">Operational</PaperKeyValue>
            </PaperKeyValueList>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperKeyValueList>
                    <PaperKeyValue label="Hostname">paperboard.local</PaperKeyValue>
                    <PaperKeyValue label="Version">3.0.0-alpha</PaperKeyValue>
                    <PaperKeyValue label="Status">Operational</PaperKeyValue>
                </PaperKeyValueList>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperKeyValue accepts item metadata properties:
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
                            <td><PaperCode>label</PaperCode></td>
                            <td><PaperCode>JSX.Element | string</PaperCode></td>
                            <td>No default</td>
                            <td>Term description rendered in the dt element with muted contrast.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>children</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td>No default</td>
                            <td>Definition content rendered in the dd element with primary contrast.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperKeyValueList renders an HTML dl element.
                Each PaperKeyValue renders an enclosing row containing dt and dd elements with bottom borders.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Render code snippets as values for system paths.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperKeyValueList>
    <PaperKeyValue label="Config path">
        <PaperCode>~/.paperboard/config.json</PaperCode>
    </PaperKeyValue>
</PaperKeyValueList>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperKeyValueList>
                    <PaperKeyValue label="Config path">
                        <PaperCode>~/.paperboard/config.json</PaperCode>
                    </PaperKeyValue>
                </PaperKeyValueList>
            </PaperCard>
        </PaperFlex>
    );
}
