import { For, Show } from "solid-js";
import {
    PaperAvatar,
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperLink,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperQuote,
    PaperText,
} from "@mileniumhq/paperui";
import type { AddonHit, AddonKind, AddonListing, InstalledAddon } from "../../lib/addons/kind";
import type { createAddonSearch } from "./state";

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** The cards of what the server already has. */
export function AddonInstalledList<Meta>(props: {
    kind: AddonKind<Meta>;
    listing: AddonListing<Meta>;
    busy: boolean;
    onOpen(item: InstalledAddon): void;
    onAction(item: InstalledAddon, does: "install" | "remove"): void;
}) {
    return (
        <Show when={props.listing.items.length > 0}>
            <PaperCard>
                <PaperFlex direction="column" gap="half" padding="full">
                    <PaperText size={5} weight={700}>
                        {props.kind.installedTitle}
                    </PaperText>
                    <Show when={props.listing.note}>
                        <PaperText size={2} color="text-subtle">
                            {props.listing.note}
                        </PaperText>
                    </Show>
                    <PaperMediaCardGroup minCardWidth="card-min">
                        <For each={props.listing.items}>
                            {(item) => (
                                <PaperMediaCard
                                    icon={<PaperAvatar src={item.iconUrl} shape="square" size="large" fallbackIcon={props.kind.glyph} />}
                                    title={item.title}
                                    subtitle={item.subtitle}
                                    badge={<PaperBadge variant={item.badge.variant}>{item.badge.label}</PaperBadge>}
                                    footerLeft={
                                        <PaperText size={2} color="text-subtle">
                                            {item.footer}
                                        </PaperText>
                                    }
                                    footerRight={
                                        <Show when={props.kind.itemActions?.length}>
                                            <PaperFlex direction="row" gap="half">
                                                <For each={props.kind.itemActions?.filter((a) => a.does !== "install" || item.project)}>
                                                    {(action) => (
                                                        <PaperButton
                                                            size="tiny"
                                                            variant={action.variant}
                                                            disabled={props.busy || action.disabled?.()}
                                                            onClick={() => props.onAction(item, action.does)}
                                                        >
                                                            <PaperIcon aria-hidden="true">{action.icon}</PaperIcon>
                                                            {action.label}
                                                        </PaperButton>
                                                    )}
                                                </For>
                                            </PaperFlex>
                                        </Show>
                                    }
                                    onClick={props.kind.itemClick === "none" ? undefined : () => props.onOpen(item)}
                                />
                            )}
                        </For>
                    </PaperMediaCardGroup>
                </PaperFlex>
            </PaperCard>
        </Show>
    );
}

/** The search box and what went wrong with it. */
export function AddonSearchCard<Meta>(props: { kind: AddonKind<Meta>; search: ReturnType<typeof createAddonSearch> }) {
    return (
        <PaperCard>
            <PaperFlex direction="column" gap="half" padding="full">
                <PaperInput
                    fullWidth
                    icon="search"
                    placeholder={props.kind.searchPlaceholder}
                    value={props.search.query()}
                    onInput={(e) => props.search.type(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") void props.search.run();
                    }}
                />
                <PaperText size={2} color="text-subtle">
                    {props.kind.searchScope()} provided by{" "}
                    <PaperLink href={props.kind.source.url} target="_blank">
                        {props.kind.source.name}
                    </PaperLink>
                    .
                </PaperText>
                <For each={props.kind.source.notices?.() ?? []}>
                    {(notice) => (
                        <PaperText size={1} color="text-subtle">
                            {notice.text}
                            <Show when={notice.link}>
                                {(link) => (
                                    <>
                                        {notice.text ? " " : ""}
                                        <PaperLink href={link().href} target="_blank">
                                            {link().label}
                                        </PaperLink>
                                    </>
                                )}
                            </Show>
                        </PaperText>
                    )}
                </For>
                <Show when={props.search.error()}>
                    <PaperQuote variant="danger" icon="warning" title="Search failed">
                        <PaperFlex direction="column" gap="half">
                            <span>{props.search.error()}</span>
                            <PaperButton disabled={props.search.searching()} onClick={() => void props.search.run()}>
                                Retry search
                            </PaperButton>
                        </PaperFlex>
                    </PaperQuote>
                </Show>
            </PaperFlex>
        </PaperCard>
    );
}

/** The grid of projects a search found. */
export function AddonResults<Meta>(props: {
    kind: AddonKind<Meta>;
    search: ReturnType<typeof createAddonSearch>;
    installedProjects: Set<string>;
    onOpen(hit: AddonHit): void;
}) {
    return (
        <>
            <Show when={props.search.searching()}>
                <PaperCard>
                    <PaperFlex padding="full" center>
                        <PaperText size={3} color="text-subtle">
                            Searching {props.kind.source.name}...
                        </PaperText>
                    </PaperFlex>
                </PaperCard>
            </Show>
            <Show when={!props.search.searching() && !props.search.error() && props.search.results()}>
                {(hits) => (
                    <PaperCard>
                        <PaperFlex padding="full" center={hits().length === 0}>
                            <Show
                                when={hits().length > 0}
                                fallback={
                                    <PaperText size={3} color="text-subtle">
                                        {props.kind.emptySearch()}
                                    </PaperText>
                                }
                            >
                                <PaperMediaCardGroup minCardWidth="card-min">
                                    <For each={hits()}>
                                        {(hit) => (
                                            <PaperMediaCard
                                                icon={<PaperAvatar src={hit.iconUrl} shape="square" size="large" fallbackIcon={props.kind.glyph} />}
                                                title={hit.title}
                                                subtitle={truncate(hit.description, 110)}
                                                badge={
                                                    props.installedProjects.has(hit.projectId) ? (
                                                        <PaperBadge variant="success">{props.kind.resultBadge}</PaperBadge>
                                                    ) : undefined
                                                }
                                                footerLeft={
                                                    <PaperText size={2} color="text-subtle">
                                                        {hit.stat}
                                                    </PaperText>
                                                }
                                                onClick={() => props.onOpen(hit)}
                                            />
                                        )}
                                    </For>
                                </PaperMediaCardGroup>
                            </Show>
                        </PaperFlex>
                    </PaperCard>
                )}
            </Show>
        </>
    );
}
