import { createSignal } from "solid-js";
import {
    PaperCard,
    PaperChip,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperChipDoc() {
    const [online, setOnline] = createSignal(true);
    const [banned, setBanned] = createSignal(false);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperChip</PaperText>
            <PaperText preset="body" as="p">
                PaperChip is a compact pill button with a pressed state, with an optional icon and count.
                Use it for filters and view switches, where each chip turns a condition on or off.
                Use <PaperLink href="/docs/paperui/paperbadge/">PaperBadge</PaperLink> for a status label that does nothing when clicked.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                A chip does not keep its own state.
                Pass <PaperCode>selected</PaperCode> from a signal and flip the signal in <PaperCode>onClick</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="half" align="center" wrap>
                    <PaperChip selected={online()} count={3} onClick={() => setOnline(!online())}>Online</PaperChip>
                    <PaperChip selected={banned()} icon="block" onClick={() => setBanned(!banned())}>Banned</PaperChip>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperCard, PaperChip, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    const [online, setOnline] = createSignal(true);
    const [banned, setBanned] = createSignal(false);

    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="half" align="center" wrap>
                <PaperChip selected={online()} count={3} onClick={() => setOnline(!online())}>Online</PaperChip>
                <PaperChip selected={banned()} icon="block" onClick={() => setBanned(!banned())}>Banned</PaperChip>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperChipProps extends <PaperCode>JSX.ButtonHTMLAttributes&lt;HTMLButtonElement&gt;</PaperCode> without <PaperCode>children</PaperCode>, which it declares itself.
                Other props, such as <PaperCode>onClick</PaperCode> and <PaperCode>title</PaperCode>, land on the <PaperCode>button</PaperCode>.
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
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>Required, no default</td>
                        <td>The chip's label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>selected</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (not selected)</td>
                        <td>Draws the chip with a primary tint and sets <PaperCode>aria-pressed="true"</PaperCode>. Anything but <PaperCode>true</PaperCode> sets <PaperCode>aria-pressed="false"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>count</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default</td>
                        <td>A trailing count. <PaperCode>0</PaperCode> is shown; leave the prop out to hide it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td>No default</td>
                        <td>A string is a Material icon name drawn before the label. An element is rendered as is.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Disables the button and dims it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>"button" | "submit" | "reset"</PaperCode></td>
                        <td><PaperCode>"button"</PaperCode></td>
                        <td>A chip never submits a form unless you set <PaperCode>type="submit"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the button.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>A chip is a real <PaperCode>button</PaperCode> with <PaperCode>aria-pressed</PaperCode>, so Enter and Space press it and screen readers announce the toggle.</li>
                <li>The chip is 32 pixels tall (<PaperCode>--paper-control-size-small</PaperCode>), pill shaped, and never wraps its label.</li>
                <li>An icon by name is hidden from assistive technology. The label and count form the accessible name.</li>
                <li>Several chips in a row are independent toggles. For exactly one active choice, use <PaperLink href="/docs/paperui/paperselector/">PaperSelector</PaperLink>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="filters">Filter row with counts</PaperText>
            <PaperText preset="body" as="p">
                The gameserver panel's player roster builds one chip per filter from data, with the count of players it would show.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, For } from "solid-js";
import { PaperChip, PaperFlex } from "@mileniumhq/paperui";

const filters = [
    { key: "online", label: "Online", count: 3 },
    { key: "banned", label: "Banned", count: 1 },
    { key: "whitelisted", label: "Whitelisted", count: 0 },
];

export function RosterFilters() {
    const [active, setActive] = createSignal<string[]>(["online"]);
    const toggle = (key: string) =>
        setActive((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

    return (
        <PaperFlex direction="row" gap="half" wrap>
            <For each={filters}>
                {(filter) => (
                    <PaperChip
                        selected={active().includes(filter.key)}
                        count={filter.count}
                        onClick={() => toggle(filter.key)}
                    >
                        {filter.label}
                    </PaperChip>
                )}
            </For>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="view-switch">Two-way view switch</PaperText>
            <PaperText preset="body" as="p">
                Two chips with opposite <PaperCode>selected</PaperCode> values switch a view, as the gameserver panel's Add maps dialog does between <PaperCode>On this server</PaperCode> and <PaperCode>Steam Workshop</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperChip, PaperFlex } from "@mileniumhq/paperui";

export function SourceSwitch() {
    const [source, setSource] = createSignal<"server" | "workshop">("server");

    return (
        <PaperFlex direction="row" gap="half">
            <PaperChip selected={source() === "server"} onClick={() => setSource("server")}>On this server</PaperChip>
            <PaperChip selected={source() === "workshop"} onClick={() => setSource("workshop")}>Steam Workshop</PaperChip>
        </PaperFlex>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
