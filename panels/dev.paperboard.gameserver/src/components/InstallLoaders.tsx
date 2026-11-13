import { For, type Accessor } from "solid-js";
import {
    PaperLoader,
    PaperLoaderGroup,
    formatByteProgress,
    type LoaderStatus,
} from "@mileniumhq/paperui";
import type { DownloadedBytes } from "../lib/ensureJava";

export interface InstallLoaderItem {
    label: string;
    /** how much the step has downloaded, while it downloads: shown under the label ("5.6 / 6 GB") */
    bytes?: Accessor<DownloadedBytes | undefined>;
    percent: Accessor<number>;
    status: Accessor<LoaderStatus>;
}

// The onboarding install rows (Setup's InstallStep), shared with the
// Versions tab so a version switch shows the same Java + jar loaders
// instead of a frozen disabled button.
const amount = (item: InstallLoaderItem) => {
    const b = item.bytes?.();
    return b && b.done > 0 && b.total > 0 ? formatByteProgress(b.done, b.total) : undefined;
};

export default function InstallLoaders(props: { items: InstallLoaderItem[] }) {
    return (
        <PaperLoaderGroup>
            <For each={props.items}>
                {(item) => (
                    <PaperLoader
                        percent={item.percent()}
                        loaderStatus={item.status()}
                        label={item.label}
                        subtitle={amount(item)}
                    />
                )}
            </For>
        </PaperLoaderGroup>
    );
}
