import {
    PaperBadge,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperBadgeDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperBadge</PaperText>
            <PaperText preset="body" as="p">
                PaperBadge is a small uppercase label that tags an item with a status or a type, such as Online, Banned, or OP.
                Use it for read-only status next to a name or title.
                Use <PaperLink href="/docs/paperui/paperchip/">PaperChip</PaperLink> when the pill must be pressable.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Put the label in the children and pick a <PaperCode>variant</PaperCode>.
                Without a variant the badge is the neutral <PaperCode>monochrome</PaperCode> one.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperBadge>Badge</PaperBadge>
                    <PaperBadge variant="success">Success</PaperBadge>
                    <PaperBadge variant="danger">Danger</PaperBadge>
                    <PaperBadge variant="warning" icon="warning">Warning</PaperBadge>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperBadge, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center">
                <PaperBadge>Badge</PaperBadge>
                <PaperBadge variant="success">Success</PaperBadge>
                <PaperBadge variant="danger">Danger</PaperBadge>
                <PaperBadge variant="warning" icon="warning">Warning</PaperBadge>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperBadgeProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLSpanElement&gt;</PaperCode>.
                Other props land on the root <PaperCode>span</PaperCode>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>variant</PaperCode></td>
                        <td><PaperCode>PaperBadgeVariant</PaperCode></td>
                        <td>No default (draws <PaperCode>monochrome</PaperCode>)</td>
                        <td><PaperCode>"monochrome"</PaperCode> or a role: <PaperCode>primary</PaperCode>, <PaperCode>brand</PaperCode>, <PaperCode>success</PaperCode>, <PaperCode>danger</PaperCode>, <PaperCode>warning</PaperCode>, <PaperCode>attention</PaperCode>, <PaperCode>extra-1</PaperCode>, <PaperCode>extra-2</PaperCode>, <PaperCode>extra-3</PaperCode>. A role gives a tinted background, border, and text. Any other value draws <PaperCode>monochrome</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A string is a Material icon name drawn before the label. An element is rendered as is.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>The label. The stylesheet uppercases it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the root.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The badge is a non-interactive <PaperCode>span</PaperCode>. It has no hover or focus state and no <PaperCode>disabled</PaperCode> prop.</li>
                <li>It is inline, fits its content, never wraps, and carries a small horizontal margin so adjacent badges do not touch.</li>
                <li>An icon given by name is hidden from assistive technology, so the label carries the meaning.</li>
                <li>A badge states a status in text. Do not rely on the variant color alone for meaning.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="variants">Every variant</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center" wrap>
                    <PaperBadge variant="monochrome">monochrome</PaperBadge>
                    <PaperBadge variant="primary">primary</PaperBadge>
                    <PaperBadge variant="brand">brand</PaperBadge>
                    <PaperBadge variant="success">success</PaperBadge>
                    <PaperBadge variant="danger">danger</PaperBadge>
                    <PaperBadge variant="warning">warning</PaperBadge>
                    <PaperBadge variant="attention">attention</PaperBadge>
                    <PaperBadge variant="extra-1">extra-1</PaperBadge>
                    <PaperBadge variant="extra-2">extra-2</PaperBadge>
                    <PaperBadge variant="extra-3">extra-3</PaperBadge>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperFlex direction="row" gap="full" align="center" wrap>
    <PaperBadge variant="monochrome">monochrome</PaperBadge>
    <PaperBadge variant="primary">primary</PaperBadge>
    <PaperBadge variant="brand">brand</PaperBadge>
    <PaperBadge variant="success">success</PaperBadge>
    <PaperBadge variant="danger">danger</PaperBadge>
    <PaperBadge variant="warning">warning</PaperBadge>
    <PaperBadge variant="attention">attention</PaperBadge>
    <PaperBadge variant="extra-1">extra-1</PaperBadge>
    <PaperBadge variant="extra-2">extra-2</PaperBadge>
    <PaperBadge variant="extra-3">extra-3</PaperBadge>
</PaperFlex>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="status">Status from data</PaperText>
            <PaperText preset="body" as="p">
                Map a state to a variant in one place, as the botcreator panel does for a bot's connection and the gameserver panel does for a player: success for online, danger for banned or failed, monochrome for neutral.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperBadge } from "@mileniumhq/paperui";

export function PlayerStatus(props: { online: boolean; banned: boolean }) {
    return (
        <PaperBadge variant={props.banned ? "danger" : props.online ? "success" : "monochrome"}>
            {props.banned ? "Banned" : props.online ? "Online" : "Offline"}
        </PaperBadge>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
