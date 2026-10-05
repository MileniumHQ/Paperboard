import { PaperFlex, PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { Switch, Match } from "solid-js";
import { Footer } from "./components/Footer";
import { Topbar } from "./components/Topbar";
import { DocsSearch } from "./components/DocsSearch";
import { Landing } from "./components/Landing";
import { DocsPage } from "./components/DocsPage";
import { NotFound } from "./components/NotFound";
import { firstPageFor, resolveRoute } from "./utils/routeUtils";
import { createPaperTheme } from "./utils/theme";

// The docs app: theme state, the persistent topbar, and the footer. Each
// deployment is a static document, so the path is passed in during SSR and
// read from window.location in the browser.
export default function App(props: { pathname?: string }) {
    const route = resolveRoute(props.pathname ?? window.location.pathname);
    const { theme, toggleTheme } = createPaperTheme();

    const section = () =>
        route.kind === "docs" || route.kind === "section"
            ? route.section
            : undefined;

    return (
        <PaperProvider theme={theme()} styleBody>
            <PaperFlex direction="column" style={{ "min-height": "100vh" }}>
                <Topbar
                    variant="docs"
                    theme={theme()}
                    toggleTheme={toggleTheme}
                    section={section()}
                    search={<DocsSearch class="topbar-search" />}
                />
                <Switch>
                    <Match when={route.kind === "docsLanding"}>
                        <Landing />
                    </Match>
                    <Match when={route.kind === "docs"}>
                        <DocsPage
                            section={route.section!}
                            pageKey={route.pageKey!}
                        />
                    </Match>
                    {/* A section root (/docs/paperui) is its first page, so
                        the section links and the README aliases land on real
                        docs */}
                    <Match
                        when={
                            route.kind === "section" &&
                            firstPageFor(route.section!)
                        }
                    >
                        <DocsPage
                            section={route.section!}
                            pageKey={firstPageFor(route.section!)!.pageKey}
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
