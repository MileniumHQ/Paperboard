import { PaperFlex, PaperProvider } from "@paperboard-dev/paperui";
import "@paperboard-dev/paperui/style.css";
import "../index.css";
import type { ParentProps } from "solid-js";
import { Footer } from "../components/Footer";
import { SiteTopbar } from "./SiteTopbar";
import styles from "./site.module.css";

// Shell for the prerendered root pages. The page text is rendered at build
// time and shipped as static HTML; the topbar is re-rendered in the browser
// (src/site/entry-client.tsx), so the menus and theme toggle use the same
// components as the docs SPA. The island wrapper is display: contents so the
// sticky topbar still positions against the page column.
export function SitePage(props: ParentProps) {
    return (
        <PaperProvider theme="dark" styleBody>
            <PaperFlex direction="column" style={{ "min-height": "100vh" }}>
                <div id="site-topbar" class={styles.topbarIsland}>
                    <SiteTopbar />
                </div>                <main class={styles.main}>
                    <div class={styles.container}>{props.children}</div>
                </main>
                <Footer />
            </PaperFlex>
        </PaperProvider>
    );
}
