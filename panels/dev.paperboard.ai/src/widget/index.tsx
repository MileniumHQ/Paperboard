// The AI panel's Home widgets: one page, the shell says which one a frame shows.

import "@mileniumhq/paperui/style.css";
import "./document.css";
import type { Component } from "solid-js";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import { defineWidgets, type WidgetContext, type WidgetMount } from "@mileniumhq/paperapi";
import { WIDGET_IDS } from "../contract";
import LoadedModel from "./LoadedModel";
import QuickAsk from "./QuickAsk";

const mount =
    (View: Component<{ widget: WidgetContext }>): WidgetMount =>
    (root, widget) =>
        render(
            () => (
                <PaperProvider fullWidth fullHeight style={{ "background-color": "transparent" }}>
                    <View widget={widget} />
                </PaperProvider>
            ),
            root,
        );

defineWidgets({
    [WIDGET_IDS.quickAsk]: mount(QuickAsk),
    [WIDGET_IDS.loadedModel]: mount(LoadedModel),
});
