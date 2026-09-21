import { PaperFlex, PaperProvider } from "@paperboard-dev/paperui";
import "@paperboard-dev/paperui/style.css";
import { createSignal, Match, Switch } from "solid-js";
import { Footer } from "./components/Footer";
import { Topbar } from "./components/Topbar";
import { Landing } from "./components/Landing";
import { DocsPage } from "./components/DocsPage";
import { NotFound } from "./components/NotFound";
import { firstPageFor, resolveRoute } from "./utils/routeUtils";

// App root/layout: theme state, the persistent topbar, and the footer. The
// current route is read from window.location once per full page load.
export default function App() {
    const route = resolveRoute();
    const [theme, setTheme] = createSignal<"dark" | "light">(
        (typeof localStorage !== "undefined" &&
            (localStorage.getItem("paper-docs-theme") as "dark" | "light")) ||
            "dark",
    );

    const toggleTheme = () => {
        const next = theme() === "dark" ? "light" : "dark";
        setTheme(next);
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("paper-docs-theme", next);
        }
        // Update the document root alongside the provider so the canvas and
        // scrollbars swap in the same frame, with no flash between them.
        if (typeof document !== "undefined") {
            document.documentElement.setAttribute(
                "data-paperui-theme",
                next,
            );
            document.documentElement.style.colorScheme = next;
        }
    };

    const section = () =>
        route.kind === "docs" ? route.section : undefined;

    return (
        <PaperProvider theme={theme()} styleBody>
            <PaperFlex direction="column" style={{ "min-height": "100vh" }}>
                <Topbar
                    theme={theme()}
                    toggleTheme={toggleTheme}
                    section={section()}
                />
                <Switch>
                    <Match when={route.kind === "landing"}>
                        <Landing />
                    </Match>
                    <Match when={route.kind === "docs"}>
                        <DocsPage
                            section={route.section!}
                            pageKey={route.pageKey!}
                        />
                    </Match>
                    <Match
                        when={
                            route.kind === "notFound" ||
                            (route.kind === "section" &&
                                !firstPageFor(route.section!))
                        }
                    >
                        <NotFound />
                    </Match>
                </Switch>
                <Footer />
            </PaperFlex>
        </PaperProvider>
    );
}
