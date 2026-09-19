import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperTableDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperTable</PaperText>
            <PaperText preset="body">
                PaperTable wraps HTML data tables with bordered cell partitions, responsive overflow scrolling, and header styles.
                Reach for PaperTable when presenting structured datasets, API parameter references, or tabular reports.
                The wrapper applies border collapse rules and subtle row division lines.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Place standard table elements (thead, tbody, tr, th, td) inside PaperTable.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperTable } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperTable>
                <thead>
                    <tr>
                        <th>Identifier</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>daemon.service</td>
                        <td>Active</td>
                    </tr>
                    <tr>
                        <td>crane.socket</td>
                        <td>Listening</td>
                    </tr>
                </tbody>
            </PaperTable>
    );
}`}
            </PaperCode>

            <PaperTable>
                    <thead>
                        <tr>
                            <th>Identifier</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>daemon.service</td>
                            <td>Active</td>
                        </tr>
                        <tr>
                            <td>crane.socket</td>
                            <td>Listening</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperTable accepts standard HTML table properties:
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
                            <td><PaperCode>children</PaperCode></td>
                            <td><PaperCode>JSX.Element</PaperCode></td>
                            <td>No default</td>
                            <td>Standard thead, tbody, and tr elements.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperTable encloses the table element in an overflow container with auto horizontal scrolling.
                Header cells apply text-transform: uppercase and letter-spacing metrics.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Embed interactive controls or badges directly inside table data cells.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperTable>
    <thead>
        <tr>
            <th>Name</th>
            <th>Type</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><PaperCode>id</PaperCode></td>
            <td>string</td>
        </tr>
    </tbody>
</PaperTable>`}
            </PaperCode>
            <PaperTable>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Type</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><PaperCode>id</PaperCode></td>
                            <td>string</td>
                        </tr>
                    </tbody>
                </PaperTable>
        </PaperFlex>
    );
}
