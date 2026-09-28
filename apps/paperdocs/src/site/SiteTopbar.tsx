import { Topbar } from "../components/Topbar";
import { createPaperTheme } from "../utils/theme";
import styles from "./site.module.css";

// Client island for the prerendered pages' chrome. The page content stays
// static HTML; only the topbar renders here, which keeps the shared menus and
// the theme toggle interactive. Importing the page stylesheet from this
// module keeps the browser bundle's CSS complete (the page components only
// exist in the server bundle).
export function SiteTopbar() {
    const { theme, toggleTheme } = createPaperTheme();

    return (
        <div class={styles.topbarIsland}>
            <Topbar theme={theme()} toggleTheme={toggleTheme} />
        </div>
    );
}
