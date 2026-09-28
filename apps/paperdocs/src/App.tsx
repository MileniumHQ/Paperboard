import { PaperFlex, PaperProvider } from "@paperboard-dev/paperui";
import "@paperboard-dev/paperui/style.css";
import { Switch, Match } from "solid-js";
import { Footer } from "./components/Footer";
import { Topbar } from "./components/Topbar";
import { DocsSearch } from "./components/DocsSearch";
import { Landing } from "./components/Landing";
import { DocsPage } from "./components/DocsPage";
import { NotFound } from "./components/NotFound";
import { firstPageFor, resolveRoute } from "./utils/routeUtils";
import { createPaperTheme } from "./utils/theme";

// App root/layout: theme state, the persistent topbar, and the footer. The
// current route is read from window.location once per full page load.
export default function App() {
    const route = resolveRoute();
    const { theme, toggleTheme } = createPaperTheme();

    const section = () =>
        route.kind === "docs" ? route.section : undefined;

    return (
        <PaperProvider theme={theme()} styleBody>
            <PaperFlex direction="column" style={{ "min-height": "100vh" }}>
                <Topbar
                    theme={theme()}
                    toggleTheme={toggleTheme}
                    section={section()}
                    search={<DocsSearch class="topbar-search" />}
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
