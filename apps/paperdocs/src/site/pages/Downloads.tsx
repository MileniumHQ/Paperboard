import { For } from "solid-js";
import { PaperButton, PaperFlex, PaperList, PaperListItem, PaperPageHeader, PaperSeparator, PaperText } from "@mileniumhq/paperui";
import { PlatformIcon } from "../platformIcons";
import { APP, DAEMON, releaseUrl, type DownloadRow } from "./downloadRows";
import { InstallCommands } from "./InstallCommands";
import styles from "../site.module.css";

// Each link is a plain release URL: download-warning.js asks how to open an
// unsigned Windows or macOS build before any of them downloads.
function DownloadList(props: { label: string; rows: DownloadRow[] }) {
    return (
        <PaperList standalone selectable={false} aria-label={props.label}>
            <For each={props.rows}>
                {(row) => (
                    <PaperListItem
                        value={row.id}
                        icon={<PlatformIcon platform={row.platform} class={styles.platformIcon} />}
                        description={row.description}
                        wrapTitle
                        actions={
                            <PaperFlex direction="row" gap="half" wrap>
                                <For each={row.files}>
                                    {(file) => (
                                        <PaperButton size="small" href={releaseUrl(file.path)} aria-label={`${row.title} ${file.label}`}>
                                            {file.label}
                                        </PaperButton>
                                    )}
                                </For>
                            </PaperFlex>
                        }
                    >
                        {row.title}
                    </PaperListItem>
                )}
            </For>
        </PaperList>
    );
}

export function Downloads() {
    return (
        <>
            <PaperPageHeader
                icon="download"
                title="Downloads"
                subtitle="Paperboard is in beta. Some features may be buggy or incomplete. Windows and macOS builds are unsigned; your operating system may warn you when you open them."
            />
            <div class={styles.stack}>
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="subheader" as="h2" class={styles.heading}>Paperboard</PaperText>
                    <PaperText preset="body" color="text-subtle">
                        The desktop app. It includes the server daemon for this computer, and updates itself however you installed it.
                    </PaperText>
                    <DownloadList label="Paperboard downloads" rows={APP} />
                </PaperFlex>
                <PaperSeparator />
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="subheader" as="h2" class={styles.heading}>From a terminal</PaperText>
                    <PaperText preset="body" color="text-subtle">
                        The install script checks the download against the release's checksums before it installs. With Node, npx opens Paperboard and asks first if it isn't installed yet.
                    </PaperText>
                    <div id="site-install">
                        <InstallCommands />
                    </div>
                </PaperFlex>
                <PaperSeparator />
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="subheader" as="h2" class={styles.heading}>Paperboard server daemon</PaperText>
                    <PaperText preset="body" color="text-subtle">
                        For a headless computer you manage from Paperboard on another device.
                    </PaperText>
                    <DownloadList label="Paperboard server daemon downloads" rows={DAEMON} />
                </PaperFlex>
            </div>
        </>
    );
}
