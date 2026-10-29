import { For, Show, type Component, type JSX } from "solid-js";
import { PaperButton, PaperFlex, PaperIcon, PaperPageHeader, PaperQuote } from "@mileniumhq/paperui";
import { AddonInstalledList, AddonResults, AddonSearchCard } from "./AddonCards";
import { AddonDetail, type DetailExtras } from "./AddonDetail";
import { AddonInstallModal, AddonRemoveModal, AddonUploadConfirmModal, type InstallExtrasProps } from "./AddonModals";
import type { AddonBrowserState } from "./state";

export interface AddonBrowserProps<Meta> {
    browser: AddonBrowserState<Meta>;
    /** buttons in the page header */
    actions?: JSX.Element;
    /** notices above the installed list */
    notices?: JSX.Element;
    /** cards between the installed list and the search, e.g. settings for the one pack in use */
    extras?: JSX.Element;
    /** the kind's own part of the install dialog */
    installExtras?: Component<InstallExtrasProps>;
    /** the kind's own part of the project page */
    detailExtras?: DetailExtras;
    /** dialogs the tab owns */
    children?: JSX.Element;
}

/**
 * One Modrinth add-on tab: the installed list, the search, the results, and
 * the install and remove dialogs, for whichever AddonKind its state was made
 * from. The tab around it adds only what its kind has that the others do not.
 */
export default function AddonBrowser<Meta = undefined>(props: AddonBrowserProps<Meta>) {
    const b = () => props.browser;
    return (
        <>
            <PaperPageHeader icon={b().kind.icon} title={b().kind.title}>
                <For each={b().kind.upload?.sources}>
                    {(source) => (
                        <PaperButton disabled={b().busy() || b().kind.upload?.disabled?.()} onClick={() => void b().upload(source)}>
                            <PaperIcon aria-hidden="true">{b().uploading() ? "hourglass_top" : source.icon}</PaperIcon>
                            {source.label}
                        </PaperButton>
                    )}
                </For>
                {props.actions}
            </PaperPageHeader>

            {props.notices}

            <Show when={b().uploadError()}>
                <PaperQuote variant="danger" icon="warning" title={b().kind.upload?.failureTitle ?? "Upload failed"}>
                    {b().uploadError()}
                </PaperQuote>
            </Show>
            <Show when={b().uploadNotice()}>
                {(notice) => (
                    <PaperQuote variant="success" icon="check_circle" title={notice().title}>
                        {notice().message}
                    </PaperQuote>
                )}
            </Show>

            <Show when={b().listError()}>
                <PaperQuote variant="danger" icon="warning" title={b().kind.listFailureTitle()}>
                    <PaperFlex direction="column" gap="half">
                        <span>{b().listError()}</span>
                        <PaperFlex direction="row" gap="half">
                            <PaperButton onClick={() => void b().reload()}>Try again</PaperButton>
                            <Show when={b().kind.recover}>
                                {(way) => (
                                    <PaperButton disabled={b().recovering() || way().disabled?.()} onClick={() => void b().recover()}>
                                        {way().label}
                                    </PaperButton>
                                )}
                            </Show>
                        </PaperFlex>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={b().recoverError()}>
                <PaperQuote variant="danger" icon="warning" title={b().kind.recover?.errorTitle ?? "Failed"}>
                    {b().recoverError()}
                </PaperQuote>
            </Show>
            <Show when={b().listing()?.warning}>
                {(warning) => (
                    <PaperQuote variant="warning" icon="warning" title={warning().title}>
                        {warning().message}
                    </PaperQuote>
                )}
            </Show>

            <PaperFlex direction="column" gap="full">
                <Show when={b().listing()}>
                    {(current) => (
                        <AddonInstalledList
                            kind={b().kind}
                            listing={current()}
                            busy={b().busy()}
                            onOpen={b().openItem}
                            onAction={b().itemAction}
                        />
                    )}
                </Show>
                {props.extras}
                <AddonSearchCard kind={b().kind} search={b().search} />
                <AddonResults kind={b().kind} search={b().search} installedProjects={b().installedProjects()} onOpen={b().openResult} />
            </PaperFlex>

            <AddonDetail
                kind={b().kind}
                target={b().detail()}
                entry={b().entryOf(b().detail())}
                busy={b().busy()}
                extras={props.detailExtras}
                onClose={b().closeDetail}
                onInstall={b().install.open}
                onRemove={b().remove.request}
            />
            <AddonInstallModal kind={b().kind} install={b().install} extras={props.installExtras} />
            <AddonRemoveModal kind={b().kind} remove={b().remove} listing={b().listing()} />
            <AddonUploadConfirmModal kind={b().kind} browser={b()} />
            {props.children}
        </>
    );
}
