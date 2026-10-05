import { For, type Accessor } from "solid-js";
import {
    PaperLoader,
    PaperLoaderGroup,
    type LoaderStatus,
} from "@mileniumhq/paperui";

export interface InstallLoaderItem {
    label: string;
    percent: Accessor<number>;
    status: Accessor<LoaderStatus>;
}

// The onboarding install rows (Setup's InstallStep), shared with the
// Versions tab so a version switch shows the same Java + jar loaders
// instead of a frozen disabled button.
export default function InstallLoaders(props: { items: InstallLoaderItem[] }) {
    return (
        <PaperLoaderGroup>
            <For each={props.items}>
                {(item) => (
                    <PaperLoader
                        percent={item.percent()}
                        loaderStatus={item.status()}
                        label={item.label}
                    />
                )}
            </For>
        </PaperLoaderGroup>
    );
}
