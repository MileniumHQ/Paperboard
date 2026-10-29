import { For, Show, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperLink,
    PaperModal,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
} from "@mileniumhq/paperui";
import type { AddonKind, AddonListing, AddonTarget, AddonVersion } from "../../lib/addons/kind";
import type { createAddonInstall, createAddonRemove } from "./state";

/** What a kind's own part of the install dialog is given. */
export interface InstallExtrasProps {
    target: AddonTarget;
    version: AddonVersion | null;
    installing: boolean;
    /** holds the install until `ready`; `payload` goes to the kind's install */
    report(state: { ready: boolean; payload?: unknown }): void;
}

/** Pick a build of a Modrinth project and install it. */
export function AddonInstallModal<Meta>(props: {
    kind: AddonKind<Meta>;
    install: ReturnType<typeof createAddonInstall<Meta>>;
    extras?: Component<InstallExtrasProps>;
}) {
    const install = () => props.install;
    return (
        <PaperModal
            open={install().target() !== null}
            onClose={install().close}
            title={install().target() ? props.kind.install.title(install().target()!) : `Install ${props.kind.noun}`}
            size="medium"
            footer={
                <>
                    <PaperButton disabled={install().installing()} onClick={install().close}>
                        Cancel
                    </PaperButton>
                    <PaperButton variant="success" disabled={!install().canConfirm()} onClick={() => void install().confirm()}>
                        <PaperIcon aria-hidden="true">{install().installing() ? "hourglass_top" : props.kind.install.icon}</PaperIcon>
                        {install().installing() ? props.kind.install.busyAction : props.kind.install.action}
                    </PaperButton>
                </>
            }
        >
            <Show when={install().target()}>
                {(target) => (
                    <PaperFlex direction="column" gap="full">
                        <Show when={!props.kind.detail}>
                            <PaperText preset="body">{target().description}</PaperText>
                            <PaperLink href={`https://modrinth.com/${props.kind.modrinthPath}/${target().slug}`} target="_blank">
                                Open at Modrinth.com
                            </PaperLink>
                        </Show>
                        <Show
                            when={install().versions()}
                            fallback={
                                <Show when={!install().error()}>
                                    <PaperText size={2} color="text-subtle">
                                        Loading versions from Modrinth...
                                    </PaperText>
                                </Show>
                            }
                        >
                            {(list) => (
                                <Show
                                    when={list().length > 0}
                                    fallback={
                                        <PaperQuote variant="warning" icon="warning" title={props.kind.install.noVersions().title}>
                                            {props.kind.install.noVersions().text}
                                        </PaperQuote>
                                    }
                                >
                                    <PaperFlex direction="column" gap="half">
                                        <PaperText size={3} weight={700}>
                                            Version
                                        </PaperText>
                                        <PaperSelectMenu
                                            name="addonVersion"
                                            aria-label={`${props.kind.noun} version`}
                                            fullWidth
                                            value={install().versionId()}
                                            disabled={install().installing()}
                                            onValueChange={(value) => install().setVersionId(String(value))}
                                        >
                                            <For each={list()}>{(v) => <PaperSelectMenuItem value={v.id}>{v.label}</PaperSelectMenuItem>}</For>
                                        </PaperSelectMenu>
                                    </PaperFlex>
                                </Show>
                            )}
                        </Show>
                        <Show when={props.extras && (install().versions()?.length ?? 0) > 0}>
                            <Dynamic
                                component={props.extras}
                                target={target()}
                                version={install().chosen()}
                                installing={install().installing()}
                                report={install().report}
                            />
                        </Show>
                        <Show when={install().error()}>
                            <PaperQuote variant="danger" icon="warning" title={props.kind.install.errorTitle}>
                                {install().error()}
                            </PaperQuote>
                        </Show>
                    </PaperFlex>
                )}
            </Show>
        </PaperModal>
    );
}

/** Confirms taking an entry out of the server. */
export function AddonRemoveModal<Meta>(props: {
    kind: AddonKind<Meta>;
    remove: ReturnType<typeof createAddonRemove<Meta>>;
    listing: AddonListing<Meta> | null;
}) {
    const remove = () => props.remove;
    return (
        <PaperModal
            open={remove().pending() !== null}
            onClose={remove().cancel}
            title={remove().pending() ? props.kind.remove.title(remove().pending()!) : "Remove"}
            size="small"
            footer={
                <>
                    <PaperButton disabled={remove().removing()} onClick={remove().cancel}>
                        Cancel
                    </PaperButton>
                    <PaperButton
                        variant="danger"
                        disabled={remove().removing() || props.kind.remove.disabled?.()}
                        onClick={() => void remove().confirm()}
                    >
                        <PaperIcon aria-hidden="true">delete</PaperIcon>
                        {remove().removing() ? props.kind.remove.busyAction : props.kind.remove.action}
                    </PaperButton>
                </>
            }
        >
            <PaperFlex direction="column" gap="half">
                <Show when={remove().pending()}>
                    {(item) => <PaperText preset="body">{props.kind.remove.describe(item(), props.listing)}</PaperText>}
                </Show>
                <Show when={remove().error()}>
                    <PaperQuote variant="danger" icon="warning" title={props.kind.remove.errorTitle}>
                        {remove().error()}
                    </PaperQuote>
                </Show>
            </PaperFlex>
        </PaperModal>
    );
}
