import { createSignal, onMount, Show, For, Index } from "solid-js";
import {
    PaperFlex,
    PaperText,
    PaperQuote,
    PaperButton,
    PaperIcon,
    PaperBadge,
    PaperCard,
    PaperEmptyState,
    PaperInput,
    PaperModal,
    PaperEffect,
    PaperPageHeader,
    PaperSettingList,
    PaperSettingItem,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperCheckbox,
    PaperCopyButton,
} from "@mileniumhq/paperui";
import { actionsApi } from "@mileniumhq/paperapi";
import { PANEL_ID, type BotSummary } from "../bots";
import {
    GLOBAL_SCOPE,
    COMMAND_DESCRIPTION_MAX_LENGTH,
    COMMAND_OPTION_TYPES,
    COMMAND_OPTION_TYPE_ICONS,
    COMMAND_OPTION_TYPE_LABELS,
    describeCommandOptionProblem,
    describeCommandProblem,
    errorToMessage,
    hasDuplicateOptionName,
    isCommandDescriptionValid,
    isCommandNameValid,
    isOptionOrderValid,
    normalizeCommandDefinitions,
    normalizeCommandName,
    type CommandMutationResult,
    type CommandOptionType,
    type GuildSummary,
    type Health,
    type SlashCommandDefinition,
    type SlashCommandOption,
} from "../types";


interface Outcome {
    title: string;
    message: string;
}

const syncProblem = (message: string): Outcome => ({ title: "Not live on Discord yet", message });

// local-only ids for builder rows; never sent to Discord
let nextOptionId = 1;
function newOptionId(): string {
    return `opt-${Date.now().toString(36)}-${nextOptionId++}`;
}

export default function Commands(props: { bot: () => BotSummary }) {
    const bot = () => props.bot().id;
    const [commands, setCommands] = createSignal<SlashCommandDefinition[]>([]);
    const [guilds, setGuilds] = createSignal<GuildSummary[]>([]);
    // null until the first health read answers: unknown is not offline
    const [connected, setConnected] = createSignal<boolean | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [guildsError, setGuildsError] = createSignal("");
    const [healthError, setHealthError] = createSignal("");
    const [actionError, setActionError] = createSignal<Outcome | null>(null);

    const [createOpen, setCreateOpen] = createSignal(false);
    const [name, setName] = createSignal("");
    const [description, setDescription] = createSignal("");
    const [scope, setScope] = createSignal(GLOBAL_SCOPE);
    const [userInstall, setUserInstall] = createSignal(false);
    const [options, setOptions] = createSignal<SlashCommandOption[]>([]);
    const [busy, setBusy] = createSignal(false);
    const [formError, setFormError] = createSignal("");

    const [deleteTarget, setDeleteTarget] = createSignal<SlashCommandDefinition | null>(
        null,
    );

    const load = async () => {
        setLoadError("");
        setGuildsError("");
        setHealthError("");
        try {
            const saved = await actionsApi.call<unknown>(PANEL_ID, "list-commands", { bot: bot() });
            setCommands(normalizeCommandDefinitions(saved));
        } catch (err) {
            console.error("[Commands] saved commands read failed:", err);
            setLoadError(errorToMessage(err));
        }

        try {
            const list = await actionsApi.call<GuildSummary[]>(PANEL_ID, "list-guilds", { bot: bot() });
            if (!Array.isArray(list)) throw new Error("list-guilds returned no server list");
            setGuilds(list);
        } catch (err) {
            console.error("[Commands] guild list read failed:", err);
            setGuildsError(errorToMessage(err));
        }

        try {
            const health = await actionsApi.call<Health>(PANEL_ID, "get-health", { bot: bot() });
            if (!health || typeof health !== "object") {
                throw new Error("get-health returned no health payload");
            }
            setConnected(Boolean(health.connected));
            if (health.commandSyncError) setActionError(syncProblem(health.commandSyncError));
        } catch (err) {
            console.error("[Commands] health read failed:", err);
            setHealthError(errorToMessage(err));
        }
    };

    onMount(() => {
        void load();
    });

    const mutationProblem = (result: CommandMutationResult): Outcome | null => {
        if (result.triggerError) return { title: "Flow trigger not registered", message: result.triggerError };
        if (result.syncError) return syncProblem(result.syncError);
        return null;
    };

    const scopeLabel = (value: string) => {
        if (value === GLOBAL_SCOPE) return "Global";
        return guilds().find((g) => g.id === value)?.name ?? value;
    };

    const openCreate = () => {
        setName("");
        setDescription("");
        // if the bot is only in one server, scope the command there by
        // default: guild commands register instantly, global ones can take
        // up to an hour to appear
        setScope(guilds().length === 1 ? guilds()[0].id : GLOBAL_SCOPE);
        setUserInstall(false);
        setOptions([]);
        setFormError("");
        setCreateOpen(true);
    };

    const isDuplicate = () => {
        const candidate = normalizeCommandName(name());
        if (!candidate) return false;
        return commands().some(
            (c) => c.scope === scope() && c.name === candidate,
        );
    };

    const optionProblems = () =>
        options().map((option, index) =>
            describeCommandOptionProblem(option, options(), index),
        );

    // the same predicates the service rejects with, applied to the inputs
    // PaperInput already knows how to render as invalid
    const optionNameInvalid = (index: number) => {
        const option = options()[index];
        if (!option) return false;
        return (
            !isCommandNameValid(option.name) ||
            hasDuplicateOptionName(options(), option.name)
        );
    };

    const optionDescriptionInvalid = (index: number) => {
        const option = options()[index];
        return option ? !isCommandDescriptionValid(option.description) : false;
    };

    const formProblem = () => {
        const problem = describeCommandProblem({
            name: name(),
            description: description(),
        });
        if (problem) return problem;
        if (isDuplicate()) return "A command with this name already exists in this scope.";
        const optionProblem = optionProblems().find((p) => Boolean(p));
        if (optionProblem) return optionProblem;
        return "";
    };

    const addOption = () => {
        setOptions((prev) => [
            ...prev,
            {
                id: newOptionId(),
                name: "",
                description: "",
                type: "string",
                required: false,
            },
        ]);
    };

    const updateOption = (id: string, patch: Partial<SlashCommandOption>) => {
        setOptions((prev) =>
            prev.map((option) => (option.id === id ? { ...option, ...patch } : option)),
        );
    };

    const removeOption = (id: string) => {
        setOptions((prev) => prev.filter((option) => option.id !== id));
    };

    const moveOption = (index: number, delta: number) => {
        setOptions((prev) => {
            const target = index + delta;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const submitCreate = async () => {
        const problem = formProblem();
        if (problem) {
            setFormError(problem);
            return;
        }
        setBusy(true);
        setFormError("");
        setActionError(null);
        try {
            const result = await actionsApi.call<CommandMutationResult>(
                PANEL_ID,
                "create-command",
                {
                    bot: bot(),
                    name: name(),
                    description: description(),
                    scope: scope(),
                    options: options(),
                    userInstall: userInstall(),
                },
            );
            setCommands((prev) => [...prev, result.command]);
            setCreateOpen(false);
            setActionError(mutationProblem(result));
        } catch (err) {
            console.error("[Commands] create-command failed:", err);
            setFormError(errorToMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const confirmDelete = async () => {
        const target = deleteTarget();
        setDeleteTarget(null);
        if (!target) return;
        setBusy(true);
        setActionError(null);
        try {
            const result = await actionsApi.call<CommandMutationResult>(
                PANEL_ID,
                "delete-command",
                { bot: bot(), id: target.id },
            );
            setCommands((prev) => prev.filter((c) => c.id !== target.id));
            setActionError(mutationProblem(result));
        } catch (err) {
            console.error("[Commands] delete-command failed:", err);
            setActionError({ title: `/${target.name} not deleted`, message: errorToMessage(err) });
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <PaperPageHeader
                        icon="terminal"
                        title="Commands"
                        subtitle="Slash commands this bot registers with Discord"
                    >
                        <PaperEffect>
                            <PaperButton onClick={openCreate}>
                                <PaperIcon>add</PaperIcon>
                                Create command
                            </PaperButton>
                        </PaperEffect>
                    </PaperPageHeader>

                    <Show when={connected() === false}>
                        <PaperQuote variant="warning" icon="cloud_off" title="Bot offline">
                            Commands are stored here and register the next time the bot
                            connects.
                        </PaperQuote>
                    </Show>

                    <Show when={loadError()}>
                        <PaperQuote variant="danger" icon="warning" title="Stored commands unreadable">
                            {loadError()}
                        </PaperQuote>
                    </Show>

                    <Show when={healthError()}>
                        <PaperQuote variant="danger" icon="warning" title="Couldn't check the bot's connection">
                            {healthError()}
                        </PaperQuote>
                    </Show>

                    <Show when={guildsError()}>
                        <PaperQuote variant="danger" icon="warning" title="Couldn't list the bot's servers">
                            {guildsError()}. New commands can only be global until the list loads.
                        </PaperQuote>
                    </Show>

                    <Show when={actionError()}>
                        {(problem) => (
                            <PaperQuote variant="danger" icon="warning" title={problem().title}>
                                {problem().message}
                            </PaperQuote>
                        )}
                    </Show>

                    <Show
                        when={commands().length > 0}
                        fallback={
                            <PaperCard>
                                <PaperEmptyState
                                    icon="terminal"
                                    title="No slash commands yet"
                                    description="Create one, then build a flow on its trigger to answer it."
                                />
                            </PaperCard>
                        }
                    >
                        <PaperSettingList autoHeight>
                            <For each={commands()}>
                                    {(command) => (
                                        <PaperSettingItem
                                            title={
                                                <PaperText preset="label" family="code">
                                                    /{command.name}
                                                </PaperText>
                                            }
                                            description={command.description}
                                        >
                                            <PaperFlex direction="row" gap="half" align="center">
                                                <Show when={command.options.length > 0}>
                                                    <PaperBadge>
                                                        {command.options.length} parameter
                                                        {command.options.length === 1 ? "" : "s"}
                                                    </PaperBadge>
                                                </Show>
                                                <Show when={command.userInstall}>
                                                    <PaperBadge>
                                                        User app
                                                    </PaperBadge>
                                                </Show>
                                                <PaperBadge
                                                    variant={
                                                        command.scope === GLOBAL_SCOPE
                                                            ? "monochrome"
                                                            : "primary"
                                                    }
                                                >
                                                    {scopeLabel(command.scope)}
                                                </PaperBadge>
                                                <PaperCopyButton
                                                    text={`/${command.name}`}
                                                    title="Copy command"
                                                />
                                                <PaperButton size="tiny"
                                                    icon
                                                    variant="danger"
                                                    title="Delete command"
                                                    disabled={busy()}
                                                    onClick={() => setDeleteTarget(command)}>
                                                    <PaperIcon>delete</PaperIcon>
                                                </PaperButton>
                                            </PaperFlex>
                                        </PaperSettingItem>
                                    )}
                                </For>
                        </PaperSettingList>
                    </Show>

            <PaperModal
                open={createOpen()}
                onClose={() => setCreateOpen(false)}
                title="Create Slash Command"
                size="large"
                footer={
                    <>
                        <PaperButton onClick={() => setCreateOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="success"
                            disabled={busy() || Boolean(formProblem())}
                            onClick={() => void submitCreate()}>
                            <PaperIcon>{busy() ? "hourglass_top" : "add"}</PaperIcon>
                            {busy() ? "Creating…" : "Create"}
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="full">
                    <PaperFlex direction="column" gap="half">
                        <PaperInput
                            fullWidth
                            label="Command"
                            placeholder="ping"
                            // one extra char so the optional leading slash fits
                            maxLength={33}
                            value={name()}
                            invalid={!isCommandNameValid(name()) || isDuplicate()}
                            // case is validated, never silently rewritten:
                            // typing "Ping" shows the requirement instead of
                            // turning into "ping" under the author's hands
                            onInput={(e) => setName(e.currentTarget.value)}
                        />
                        <PaperInput
                            fullWidth
                            label="Description"
                            maxLength={COMMAND_DESCRIPTION_MAX_LENGTH}
                            value={description()}
                            invalid={!isCommandDescriptionValid(description())}
                            onInput={(e) => setDescription(e.currentTarget.value)}
                        />

                        <PaperSelectMenu
                            name="commandScope"
                            fullWidth
                            value={scope()}
                            onValueChange={(val) => {
                                const next = String(val);
                                setScope(next);
                                // Discord only honors installation contexts
                                // on global commands
                                if (next !== GLOBAL_SCOPE) setUserInstall(false);
                            }}
                        >
                            <PaperSelectMenuItem value={GLOBAL_SCOPE} icon="public">
                                Global (every server)
                            </PaperSelectMenuItem>
                            <For each={guilds()}>
                                {(guild) => (
                                    <PaperSelectMenuItem value={guild.id} icon="dns">
                                        {guild.name} (this server only)
                                    </PaperSelectMenuItem>
                                )}
                            </For>
                        </PaperSelectMenu>

                        <Show when={scope() === GLOBAL_SCOPE}>
                            <PaperQuote variant="warning" icon="schedule" title="Propagation">
                                Global commands can take up to an hour to appear. Pick a
                                server while testing to register instantly.
                            </PaperQuote>
                        </Show>

                        <Show when={scope() === GLOBAL_SCOPE}>
                            <PaperCheckbox
                                checked={userInstall()}
                                label="Also available as a user app"
                                onChange={(checked) => setUserInstall(checked)}
                            />
                            <Show when={userInstall()}>
                                <PaperText preset="hint">
                                    Users can install this command on their
                                    account so it works in DMs and servers
                                    without the bot. Needs User Install
                                    enabled in the Discord developer portal.
                                </PaperText>
                            </Show>
                        </Show>
                    </PaperFlex>

                    <PaperFlex direction="column" gap="half">
                        <PaperFlex direction="row" justify="space-between" align="center">
                            <PaperText preset="heading">
                                Parameters
                            </PaperText>
                            <PaperButton onClick={addOption}>
                                <PaperIcon>add</PaperIcon>
                                Add parameter
                            </PaperButton>
                        </PaperFlex>

                        <Show when={options().length === 0}>
                            <PaperText preset="hint">
                                No parameters. Discord shows this command with no
                                arguments.
                            </PaperText>
                        </Show>

                        <Index each={options()}>
                            {(option, index) => {
                                const orderProblem = () =>
                                    !isOptionOrderValid(options(), index);
                                return (
                                    <PaperCard padding="full" gap="half">
                                            <PaperFlex direction="row" gap="half" align="end" wrap>
                                                <PaperFlex width="field">
                                                    <PaperSelectMenu
                                                        name={`optionType-${option().id}`}
                                                        value={option().type}
                                                        onValueChange={(val) =>
                                                            updateOption(option().id, {
                                                                type: String(val) as CommandOptionType,
                                                            })
                                                        }
                                                    >
                                                        <For each={COMMAND_OPTION_TYPES}>
                                                            {(type) => (
                                                                <PaperSelectMenuItem
                                                                    value={type}
                                                                    icon={COMMAND_OPTION_TYPE_ICONS[type]}
                                                                >
                                                                    {COMMAND_OPTION_TYPE_LABELS[type]}
                                                                </PaperSelectMenuItem>
                                                            )}
                                                        </For>
                                                    </PaperSelectMenu>
                                                </PaperFlex>
                                                <PaperFlex flex minWidth="field-medium">
                                                    <PaperInput
                                                        fullWidth
                                                        label="Parameter name"
                                                        value={option().name}
                                                        invalid={optionNameInvalid(index)}
                                                        onInput={(e) =>
                                                            updateOption(option().id, {
                                                                name: e.currentTarget.value,
                                                            })
                                                        }
                                                    />
                                                </PaperFlex>
                                                <PaperFlex direction="row" gap="onefourth">
                                                    <PaperButton size="tiny"
                                                        icon
                                                        title="Move up"
                                                        disabled={index === 0}
                                                        onClick={() => moveOption(index, -1)}>
                                                        <PaperIcon>arrow_upward</PaperIcon>
                                                    </PaperButton>
                                                    <PaperButton size="tiny"
                                                        icon
                                                        title="Move down"
                                                        disabled={index === options().length - 1}
                                                        onClick={() => moveOption(index, 1)}>
                                                        <PaperIcon>arrow_downward</PaperIcon>
                                                    </PaperButton>
                                                    <PaperButton size="tiny"
                                                        icon
                                                        variant="danger"
                                                        title="Remove parameter"
                                                        onClick={() => removeOption(option().id)}>
                                                        <PaperIcon>delete</PaperIcon>
                                                    </PaperButton>
                                                </PaperFlex>
                                            </PaperFlex>

                                            <PaperInput
                                                fullWidth
                                                label="Parameter description"
                                                value={option().description}
                                                invalid={optionDescriptionInvalid(index)}
                                                onInput={(e) =>
                                                    updateOption(option().id, {
                                                        description: e.currentTarget.value,
                                                    })
                                                }
                                            />

                                            <PaperCheckbox
                                                checked={option().required}
                                                label="Required"
                                                onChange={(checked) =>
                                                    updateOption(option().id, {
                                                        required: checked,
                                                    })
                                                }
                                            />

                                            <Show when={orderProblem()}>
                                                <PaperText preset="error">
                                                    Required parameters must come before
                                                    optional ones.
                                                </PaperText>
                                            </Show>
                                    </PaperCard>
                                );
                            }}
                        </Index>
                    </PaperFlex>

                    <Show when={formError()}>
                        <PaperQuote variant="danger" icon="warning" title="Command not created">
                            {formError()}
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={deleteTarget() !== null}
                onClose={() => setDeleteTarget(null)}
                title={`Delete /${deleteTarget()?.name ?? ""}`}
                size="small"
                footer={
                    <>
                        <PaperButton onClick={() => setDeleteTarget(null)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={busy()}
                            onClick={() => void confirmDelete()}>
                            Delete
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="text">
                    This removes the command and its trigger. Flows bound to the trigger
                    stop firing until a command with this name is created again.
                </PaperText>
            </PaperModal>
        </>
    );
}

export { Commands };
