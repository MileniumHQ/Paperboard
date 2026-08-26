import {
    PaperBadge,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperTable</PaperText>
            <PaperText preset="body">
                <strong>PaperTable</strong> is a tabular data presentation primitive equipped with an automatic horizontal overflow wrapper, pre-styled column headers, and token-bound cell typography.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperTable</strong> formats structured datasets, property matrices, and API specifications. It encapsulates a native HTML <PaperCode>&lt;table&gt;</PaperCode> within a responsive overflow container, applying border tokens, uppercase header typography, and consistent cell padding.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                The component accepts standard <PaperCode>&lt;thead&gt;</PaperCode>, <PaperCode>&lt;tbody&gt;</PaperCode>, <PaperCode>&lt;tr&gt;</PaperCode>, <PaperCode>&lt;th&gt;</PaperCode>, and <PaperCode>&lt;td&gt;</PaperCode> elements:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperTable, PaperBadge, PaperCode } from "@paperboard-dev/paperui";

function DatasetTable() {
    return (
        <PaperTable>
            <thead>
                <tr>
                    <th>Service Name</th>
                    <th>Status</th>
                    <th>Latency</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><PaperCode>auth-relay</PaperCode></td>
                    <td><PaperBadge variant="green">Operational</PaperBadge></td>
                    <td>14ms</td>
                </tr>
                <tr>
                    <td><PaperCode>db-sync</PaperCode></td>
                    <td><PaperBadge variant="yellow">Syncing</PaperBadge></td>
                    <td>128ms</td>
                </tr>
            </tbody>
        </PaperTable>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full">
                    <PaperTable>
                        <thead>
                            <tr>
                                <th>Service Name</th>
                                <th>Status</th>
                                <th>Latency</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><PaperCode>auth-relay</PaperCode></td>
                                <td><PaperBadge variant="green">Operational</PaperBadge></td>
                                <td>14ms</td>
                            </tr>
                            <tr>
                                <td><PaperCode>db-sync</PaperCode></td>
                                <td><PaperBadge variant="yellow">Syncing</PaperBadge></td>
                                <td>128ms</td>
                            </tr>
                            <tr>
                                <td><PaperCode>cache-engine</PaperCode></td>
                                <td><PaperBadge variant="green">Operational</PaperBadge></td>
                                <td>2ms</td>
                            </tr>
                        </tbody>
                    </PaperTable>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical specification
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
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Table structure containing thead, tbody, and tr row definitions.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode> / <PaperCode>classList</PaperCode></td>
                        <td><PaperCode>string | Record&lt;string, boolean&gt;</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Custom class names applied directly to the internal table element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperlist">PaperList</PaperLink> — Vertical list component for selectable datasets.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbadge">PaperBadge</PaperLink> — Status badge component for cell status annotations.
                </PaperText>
            </PaperTextList>
        </>
    );
}
