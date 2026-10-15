import { PaperMarkdown, PaperPageHeader } from "@mileniumhq/paperui";
import text from "./privacy.md?raw";
import styles from "../site.module.css";

export function Privacy() {
    return (
        <>
            <PaperPageHeader
                icon="shield"
                title="Privacy"
                subtitle="What leaves your computers when you use Paperboard, and where it goes."
            />
            <div class={styles.postBody}>
                <PaperMarkdown text={text} />
            </div>
        </>
    );
}
