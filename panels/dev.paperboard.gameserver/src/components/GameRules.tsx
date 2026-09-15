import { createSignal, createEffect, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperInput,
    PaperLink,
    PaperQuote,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    PaperToggle,
    PaperCard,
} from "@paperboard-dev/paperui";
import { serverStatus, serverBridge, gamerules } from "../lib/server";
import { ACTION_IDS } from "../service/contract";
import { mcVersionAtLeast } from "../lib/capabilities";
import { humanizeIdentifier } from "../core/format";
import { GAMERULES } from "../generated/gamerules.generated";
import { PaperPageHeader } from "@paperboard-dev/paperui";

const WIKI_URL = "https://minecraft.wiki/w/Game_rule";

function availableGamerules() {
    return GAMERULES.filter((rule) => !rule.addedIn || mcVersionAtLeast(rule.addedIn));
}

function RuleControl(props: {
    valueType: string;
    value: () => string;
    onUpdate: (value: string) => void;
}) {
    return (
        <Show
            when={props.valueType === "boolean"}
            fallback={
                <PaperInput
                    type={props.valueType === "number" ? "number" : "text"}
                    value={props.value()}
                    onInput={(e) => props.onUpdate(e.currentTarget.value)}
                />
            }
        >
            <PaperToggle
                checked={props.value() === "true"}
                onChange={(checked) => props.onUpdate(String(checked))}
            />
        </Show>
    );
}

export default function GameRules() {
    const [search, setSearch] = createSignal("");

    const isOnline = () => serverStatus() === "online";

    // truth, not defaults: the service reads every visible rule from the
    // running server (and re-applies offline edits at boot); responses
    // arrive through the log parser and sync into the gamerules() signal.
    // Until a response lands, the registry default is the honest fallback.
    createEffect(() => {
        if (!isOnline()) return;
        serverBridge
            .call(ACTION_IDS.queryGamerules, {
                names: availableGamerules().map((rule) => rule.name),
            })
            .catch((err) => console.error("[gamerules] server sync failed:", String(err)));
    });

    // the service owns the console and the config: online edits go live,
    // offline edits persist and re-apply at next start — nothing is
    // silently discarded
    const updateRule = (name: string, value: string) => {
        serverBridge
            .call(ACTION_IDS.setGamerule, { name, value })
            .catch((err) => console.error(`[gamerules] set ${name} failed:`, String(err)));
    };

    const visibleGamerules = () => {
        const query = search().toLowerCase().trim();
        if (!query) return availableGamerules();
        return availableGamerules().filter(
            (rule) =>
                rule.name.toLowerCase().includes(query) ||
                humanizeIdentifier(rule.name).toLowerCase().includes(query) ||
                rule.description.toLowerCase().includes(query),
        );
    };

    return (
        <>
                    <PaperPageHeader icon="list_alt_check" title="Game Rules" />
                    <PaperCard>
                        <PaperFlex padding="full">
                            <PaperInput
                                fullWidth
                                icon="search"
                                placeholder="Search game rules..."
                                value={search()}
                                onInput={(e) => setSearch(e.currentTarget.value)}
                            />
                        </PaperFlex>
                    </PaperCard>
                        <PaperSettingList autoHeight>
                            <PaperFlex direction="column" gap="half" padding="full">
                                <Show
                                    when={isOnline()}
                                    fallback={
                                        <PaperQuote variant="warning" icon="info" title="Server offline">
                                            Edits are saved and applied the next time the server starts. Values
                                            load live once it is online.
                                        </PaperQuote>
                                    }
                                >
                                    <PaperText size={2} color="text-subtle">
                                        Values are read live from the running server.
                                    </PaperText>
                                </Show>
                                <PaperText size={2} color="text-subtle">
                                    Descriptions provided by{" "}
                                    <PaperLink href={WIKI_URL} target="_blank">Minecraft Wiki</PaperLink>.
                                </PaperText>
                            </PaperFlex>
                            <For each={visibleGamerules()}>
                                {(rule) => (
                                    <PaperSettingItem
                                        title={humanizeIdentifier(rule.name)}
                                        description={rule.description}
                                    >
                                        <RuleControl
                                            valueType={rule.valueType}
                                            value={() => gamerules()[rule.name] ?? rule.defaultValue}
                                            onUpdate={(value) => updateRule(rule.name, value)}
                                        />
                                    </PaperSettingItem>
                                )}
                            </For>
                        </PaperSettingList>
        </>
    );
}
