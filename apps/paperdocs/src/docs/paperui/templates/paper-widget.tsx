import {
    PaperButton,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
    PaperWidget,
    PaperWidgetMessage,
    PaperWidgetRows,
    PaperWidgetStat,
} from "@mileniumhq/paperui";
import styles from "./paper-widget.module.css";

export default function PaperWidgetDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperWidget</PaperText>
            <PaperText preset="body">
                PaperWidget lays out one Home widget: a one-line header, a body, and an optional footer, all on one left edge.
                Build every widget from it, and its body from PaperWidgetStat, PaperWidgetRows and PaperWidgetMessage, so widgets
                from different panels line up next to Paperboard's own.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                PaperWidget fills its tile and paints the card surface. Padding and type grow a little with the tile, between fixed ends.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperWidget, PaperWidgetStat } from "@mileniumhq/paperui";

export function Disk(props: { freeBytes: number; used: number }) {
    return (
        <PaperWidget title="Disk" icon="hard_drive">
            <PaperWidgetStat
                value="120 GB free"
                caption="76% of 500 GB used"
                meter={{ value: props.used, max: 1 }}
            />
        </PaperWidget>
    );
}`}
            </PaperCode>
            <div class={styles.examples}>
                <div class={styles.tile}>
                    <PaperWidget title="Disk" icon="hard_drive">
                        <PaperWidgetStat value="120 GB free" caption="76% of 500 GB used" meter={{ value: 0.76, max: 1 }} />
                    </PaperWidget>
                </div>
                <div class={styles.tile}>
                    <PaperWidget title="Computers" icon="computer" detail="1/2 online">
                        <PaperWidgetRows
                            rows={[
                                { id: "a", label: "This Computer", detail: "Online", tone: "success" },
                                { id: "b", label: "Media server", detail: "Offline", tone: "none" },
                            ]}
                        />
                    </PaperWidget>
                </div>
                <div class={styles.tile}>
                    <PaperWidget title="Server">
                        <PaperWidgetMessage title="Not answering" description="Game Server didn't reply." tone="danger">
                            <PaperButton size="tiny">Retry</PaperButton>
                        </PaperWidgetMessage>
                    </PaperWidget>
                </div>
            </div>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Part</th>
                        <th>Props</th>
                        <th>Use it for</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>PaperWidget</PaperCode></td>
                        <td><PaperCode>title, icon, detail, action, footer</PaperCode></td>
                        <td>The widget. Omit the title only for a face, like a clock. The detail is a count or unit; the action is one compact control.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PaperWidgetStat</PaperCode></td>
                        <td><PaperCode>value, caption, tone, meter</PaperCode></td>
                        <td>The figure the widget is about, sized by its tile. A tone colors the value; a meter adds a bar.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PaperWidgetStats</PaperCode></td>
                        <td>children</td>
                        <td>Stats side by side, sharing the width.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PaperWidgetRows</PaperCode></td>
                        <td><PaperCode>rows: {"{ id, label, detail, tone, ariaLabel, onClick }"}[]</PaperCode></td>
                        <td>A list. A row with onClick is a button and needs an ariaLabel; rows that don't fit are left out whole.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PaperWidgetMessage</PaperCode></td>
                        <td><PaperCode>title, description, tone, children</PaperCode></td>
                        <td>Loading, empty, and failed states. Danger and warning make it an alert; children are the way out.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PaperWidgetDot</PaperCode></td>
                        <td><PaperCode>tone</PaperCode></td>
                        <td>A status dot beside a word, in a detail or footer. Never the only signal.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                The header is the same height in every widget, whatever sits in it. Content too tall for a short tile clips at the
                bottom, never over the header. In a one-row tile, put a message's way out in the header's action rather than under it.
            </PaperText>
        </PaperFlex>
    );
}
