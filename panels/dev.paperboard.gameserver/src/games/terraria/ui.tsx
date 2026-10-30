import { createSignal, onMount, Show, For } from "solid-js";
import { PaperButton, PaperFlex, PaperInput, PaperText, PaperQuote, PaperSelectMenu, PaperSelectMenuItem, PaperConsole, PaperPageHeader, PaperSettingList, PaperSettingItem } from "@mileniumhq/paperui";
import type { GameUI } from "../uiTypes";
import { serverBridge, serverStatus, serverEntries, serverPort, serverActionError, serverVersion, installProgress } from "../../lib/server";
import { releases } from "./catalog";

export const terrariaUI: GameUI = {
    create() {
        const [error, setError] = createSignal("");
        const [busy, setBusy] = createSignal(false);
        const [version, setVersion] = createSignal(releases[0].version as string);
        const [name, setName] = createSignal("World");
        const [port, setPort] = createSignal("7777");
        const [worlds, setWorlds] = createSignal<string[]>([]);
        const [support, setSupport] = createSignal<{ supported: boolean; reason?: string } | null>(null);
        const act = async (work: () => Promise<unknown>) => {
            setBusy(true); setError("");
            try { await work(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
        };
        const load = async () => {
            const info = await serverBridge.call<{ host: { supported: boolean; reason?: string } }>("terraria-versions");
            setSupport(info.host);
            setWorlds(await serverBridge.call<string[]>("terraria-worlds"));
        };
        onMount(() => void act(load));
        const failure = () => <><Show when={error()}><PaperQuote variant="danger" title="Terraria operation failed">{error()}</PaperQuote></Show><Show when={support() && !support()!.supported}><PaperQuote variant="warning" title="Host not supported">{support()!.reason}</PaperQuote></Show></>;
        const versionPicker = () => <PaperSelectMenu name="terrariaVersion" value={version()} disabled={busy()} onValueChange={setVersion}><For each={releases}>{r => <PaperSelectMenuItem value={r.version}>{r.version}</PaperSelectMenuItem>}</For></PaperSelectMenu>;
        return {
            setup: props => <PaperFlex direction="column" gap="full" padding="full">
                <PaperPageHeader title="Set up Terraria" icon="landscape" />{failure()}
                <PaperText>Vanilla dedicated server from terraria.org. A small world is created on first start. Change creation settings in Options before starting. tModLoader is not available.</PaperText>
                {versionPicker()}
                <PaperButton disabled={busy() || !support()?.supported} onClick={() => void act(async () => { await serverBridge.call("terraria-install", { version: version() }, { timeoutMs: null }); props.onComplete(); })}>{busy() ? `Installing… ${Math.round(installProgress()?.percent ?? 0)}%` : "Install Terraria"}</PaperButton>
            </PaperFlex>,
            tab(id) {
                switch (id) {
                    case "overview": return <PaperFlex direction="column" gap="full">
                        <PaperPageHeader title="Terraria" icon="landscape" />{failure()}
                        <Show when={serverActionError()}><PaperQuote variant="danger">{serverActionError()}</PaperQuote></Show>
                        <PaperText>Vanilla {serverVersion()} · {serverStatus()} · TCP {serverPort()}</PaperText>
                        <PaperFlex gap="half"><For each={["start", "stop", "restart"]}>{verb => <PaperButton disabled={busy()} onClick={() => void act(() => serverBridge.call(`${verb}-server`))}>{verb}</PaperButton>}</For><PaperButton disabled={busy() || serverStatus() !== "online"} onClick={() => void act(() => serverBridge.call("terraria-save", undefined, { timeoutMs: null }))}>Save world</PaperButton></PaperFlex>
                        <PaperText>Backups save and stop Terraria, copy its files, then restart it if it was running. Players and Minecraft MOTD widgets are unavailable.</PaperText>
                    </PaperFlex>;
                    case "console": return <PaperFlex direction="column" fullHeight gap="half">{failure()}<PaperConsole entries={serverEntries()} onCommand={command => void act(() => serverBridge.call("run-command", { command }))} /></PaperFlex>;
                    case "versions": return <PaperFlex direction="column" gap="full"><PaperPageHeader title="Versions" icon="deployed_code" />{failure()}{versionPicker()}<PaperText>Take an offline backup before updating; Terraria can change the world format. Installed releases and worlds are kept.</PaperText><PaperButton disabled={busy() || serverStatus() !== "offline" || !support()?.supported} onClick={() => void act(() => serverBridge.call("terraria-install", { version: version() }, { timeoutMs: null }))}>Install selected release</PaperButton></PaperFlex>;
                    case "worlds": return <PaperFlex direction="column" gap="full"><PaperPageHeader title="Worlds" icon="public" />{failure()}
                        <PaperText>Place .wld files in this server's worlds folder while stopped, then refresh and select one. New worlds use the size, difficulty and seed in Options.</PaperText>
                        <PaperButton disabled={busy()} onClick={() => void act(load)}>Refresh worlds</PaperButton>
                        <PaperSettingList autoHeight><For each={worlds()}>{world => <PaperSettingItem title={world}><PaperButton disabled={busy() || serverStatus() !== "offline"} onClick={() => void act(() => serverBridge.call("terraria-world", { name: world, create: false, port: Number(port()) }))}>Select</PaperButton></PaperSettingItem>}</For></PaperSettingList>
                        <PaperInput label="New world name" value={name()} onInput={e => setName(e.currentTarget.value)} />
                        <PaperInput label="TCP port" type="number" value={port()} onInput={e => setPort(e.currentTarget.value)} />
                        <PaperButton disabled={busy() || serverStatus() !== "offline"} onClick={() => void act(() => serverBridge.call("terraria-world", { name: name(), create: true, port: Number(port()) }))}>Use new world on next start</PaperButton>
                    </PaperFlex>;
                    default: throw new Error(`Terraria tab has no renderer: ${id}`);
                }
            },
        };
    },
};
