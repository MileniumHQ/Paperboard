import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function WidgetsDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Widgets</PaperText>
            <PaperText preset="body">
                A widget is a small live view a panel offers for Home, the first tab of Paperboard.
                A panel declares its widgets in its manifest and draws them from one page, widget.html, with defineWidgets.
                People choose a widget and a size from the widget gallery and place it anywhere on Home.
            </PaperText>
            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Declare each widget in manifest.json with an id, a name, and the sizes it is designed for. Sizes are in Home grid cells, width by height. The first is the default.
            </PaperText>
            <PaperCode block language="json">
{`{
  "id": "com.example.status",
  "name": "Status",
  "version": "0.1.0",
  "widgets": [
    { "id": "status", "name": "Server status", "description": "Uptime at a glance", "sizes": ["2x1", "2x2"] }
  ]
}`}
            </PaperCode>
            <PaperText preset="body">
                Build a page to dist/widget.html beside the panel's main page. It calls defineWidgets once with a mount function for each widget id.
            </PaperText>
            <PaperCode block language="tsx">
{`import { render } from "solid-js/web";
import { defineWidgets, type WidgetContext } from "@mileniumhq/paperapi";

function Status(props: { widget: WidgetContext }) {
    return <button onClick={() => props.widget.openPanel()}>Open</button>;
}

defineWidgets({
    status: (root, widget) => render(() => <Status widget={widget} />, root),
});`}
            </PaperCode>
            <PaperText preset="subheader" id="manifest-rules">Manifest rules</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>id</PaperCode></td>
                        <td>string</td>
                        <td>Lowercase letters, digits and hyphens, up to 32 characters, starting with a letter or digit. Unique within the panel.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>name</PaperCode></td>
                        <td>string</td>
                        <td>Shown in the widget gallery. Up to 64 characters.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td>string</td>
                        <td>Optional line under the name in the gallery. Up to 256 characters.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>sizes</PaperCode></td>
                        <td>string[]</td>
                        <td>One to four sizes such as 2x1, each at most 4 cells wide and 4 cells tall, with no repeats.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body">
                A panel declares at most 8 widgets. A manifest that breaks a rule is refused when the panel is packed, with a message naming the first widget at fault.
                Packing also fails when the manifest declares widgets and dist/widget.html does not exist.
            </PaperText>
            <PaperText preset="subheader" id="methods-and-signatures">Methods and signatures</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Export</th>
                        <th>Signature</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>defineWidgets</PaperCode></td>
                        <td><PaperCode>defineWidgets(widgets: Record&lt;string, WidgetMount&gt;): void</PaperCode></td>
                        <td>Registers the mount function for each widget id. Call it once per page.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>WidgetMount</PaperCode></td>
                        <td><PaperCode>(root: HTMLElement, widget: WidgetContext) =&gt; (() =&gt; void) | void</PaperCode></td>
                        <td>Draws a widget into root. The function it returns is called when the widget goes away.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>validateWidgetDeclarations</PaperCode></td>
                        <td><PaperCode>validateWidgetDeclarations(raw: unknown): WidgetDeclaration[]</PaperCode></td>
                        <td>Returns a manifest's widget declarations, or throws naming the first one that breaks the rules. A missing field means no widgets.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>parseWidgetSize</PaperCode></td>
                        <td><PaperCode>parseWidgetSize(value: unknown): WidgetSize | null</PaperCode></td>
                        <td>Turns 2x1 into &#123; w: 2, h: 1 &#125;. Returns null for anything larger than the grid allows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>isWidgetId</PaperCode></td>
                        <td><PaperCode>isWidgetId(value: unknown): value is string</PaperCode></td>
                        <td>Whether a value is a valid widget id.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body">
                The mount function receives a WidgetContext for its placement on Home.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Member</th>
                        <th>Type</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>panelId</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>The panel this widget belongs to.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>widgetId</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Which declared widget this frame shows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>instanceId</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>This placement on Home. Two copies of one widget get two ids.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size()</PaperCode></td>
                        <td><PaperCode>WidgetSize</PaperCode></td>
                        <td>The current size in grid cells, one of the sizes the manifest declares.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>visible()</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>False while Home is hidden or the widget is scrolled out of view.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onResize(callback)</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>Calls back when the size changes. Returns a function that unsubscribes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onVisibilityChange(callback)</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>Calls back when the widget becomes visible or hidden. Returns a function that unsubscribes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>openPanel()</PaperCode></td>
                        <td><PaperCode>void</PaperCode></td>
                        <td>Asks Paperboard to open this widget's panel.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body">
                The constants WIDGET_ENTRY (widget.html), WIDGET_MAX_WIDTH (4), WIDGET_MAX_HEIGHT (4), MAX_WIDGETS_PER_PANEL (8) and MAX_SIZES_PER_WIDGET (4) are exported for tools that check manifests.
                Each PanelItem returned by the Panels API carries the installed manifest's declarations in its widgets field.
            </PaperText>
            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                One frame shows one widget instance, on the panel's own origin. Paperboard tells the page which widget to mount, and reports the widget as loaded once its mount function has run.
                Home loads a few widget frames at a time and releases frames that stay out of view, so a mount function may run again later for the same placement.
                defineWidgets throws when it is called twice, when a key is not a valid widget id, or when a value is not a function.
                Each of onResize and onVisibilityChange holds at most 64 listeners. Subscribing past that throws, so unsubscribe listeners that are no longer needed.
            </PaperText>
            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Pause timers and polling while the widget cannot be seen. A widget that keeps working while hidden spends the computer's CPU on nothing.
            </PaperText>
            <PaperCode block language="tsx">
{`defineWidgets({
    clock: (root, widget) => {
        let timer: ReturnType<typeof setInterval> | undefined;
        const draw = () => { root.textContent = new Date().toLocaleTimeString(); };
        const sync = () => {
            clearInterval(timer);
            if (!widget.visible()) return;
            draw();
            timer = setInterval(draw, 1000);
        };
        const stop = widget.onVisibilityChange(sync);
        sync();
        return () => {
            stop();
            clearInterval(timer);
        };
    },
});`}
            </PaperCode>
        </PaperFlex>
    );
}
