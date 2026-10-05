import { PaperMarkdown, PaperPageHeader } from "@paperboard-dev/paperui";
import text from "./downloads.md?raw";
import styles from "../site.module.css";

export function Downloads() {
    return (
        <>
            <PaperPageHeader
                icon="download"
                title="Downloads"
                subtitle="Paperboard is in alpha. Some features may be buggy or incomplete. Windows and macOS builds are unsigned; your operating system may warn you when you open them."
            />
            <div class={styles.postBody}>
                <PaperMarkdown text={text} />
            </div>
        </>
    );
}
