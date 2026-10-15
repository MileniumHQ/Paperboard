// Game Server's Home widgets: one page, the shell says which one a frame
// shows. Nothing here loads the panel's own bridge (lib/server.ts); each
// widget opens its own while it can be seen.
import type { Component } from "solid-js";
import { render } from "solid-js/web";
import { defineWidgets, type WidgetContext } from "@mileniumhq/paperapi";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "./widget/widget.css";
import { ConsoleWidget, MotdWidget, PlayersWidget, StatusWidget } from "./widget/Widgets";

const mount = (Widget: Component<{ widget: WidgetContext }>) => (root: HTMLElement, widget: WidgetContext) =>
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <Widget widget={widget} />
            </PaperProvider>
        ),
        root,
    );

defineWidgets({
    status: mount(StatusWidget),
    players: mount(PlayersWidget),
    console: mount(ConsoleWidget),
    motd: mount(MotdWidget),
});
