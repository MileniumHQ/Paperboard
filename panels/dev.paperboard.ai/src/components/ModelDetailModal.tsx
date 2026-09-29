import { createMemo, createSignal, For, Show } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperEffect,
    PaperIcon,
    PaperModal,
    PaperProgress,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";
import { UI_ACTION_IDS } from "../contract";
import { modelRef, type CatalogModel } from "../core/catalog";
import { FIT_LABELS, formatBytes } from "../core/fit";
import { CAPABILITY_LABELS, knownCapabilities } from "../lib/capabilities";
import { fitFor, makerOf } from "../lib/catalog";
import { ensureProviderReady } from "../lib/provisioning";
import { call, errorText, state } from "../lib/state";
import FitMeter from "./FitMeter";
import MakerLogo from "./MakerLogo";
import styles from "./ModelDetailModal.module.css";

export interface ModelDetailModalProps {
    model: CatalogModel | null;
    tag: string;
    onTagChange: (tag: string) => void;
    onClose: () => void;
    /** When set, an installed model can be handed to the caller for use. */
    onPick?: (ref: string) => void;
}

/**
 * Everything about one catalog model: the size choice (with fit dots), the
 * statistics, and the download. A running download replaces the fit meter
 * and statistics with a plain progress bar.
 */
export default function ModelDetailModal(props: ModelDetailModalProps) {
    const [error, setError] = createSignal("");
    const model = () => props.model;
    const selected = createMemo(() => model()?.tags.find((t) => t.tag === props.tag) ?? model()?.tags[0]);
    const ref = () => (model() && selected() ? modelRef(model()!.name, selected()!.tag) : "");
    const maker = () => (model() ? makerOf(model()!.name) : undefined);
    const fit = createMemo(() => (selected() ? fitFor(selected()!.bytes, selected()!.context) : null));
    const pull = () => state.pulls.find((p) => p.model === ref());
    const installed = () => state.models.some((m) => m.name === ref());
    const speed = () => state.speeds[ref()]?.tokensPerSecond;
    const percent = () => {
        const p = pull();
        return p && p.totalBytes > 0 ? Math.round((p.completedBytes / p.totalBytes) * 100) : 0;
    };

    const capabilities = () => knownCapabilities(model()?.capabilities ?? []);

    const download = async () => {
        setError("");
        try {
            await ensureProviderReady();
            await call(UI_ACTION_IDS.pullModel, { model: ref() });
        } catch (err) {
            setError(errorText(err));
        }
    };

    const cancel = async () => {
        setError("");
        try {
            await call(UI_ACTION_IDS.cancelPull, { model: ref() });
        } catch (err) {
            setError(errorText(err));
        }
    };

    return (
        <PaperModal
            open={model() !== null}
            onClose={props.onClose}
            title="Download Model"
            size="large"
            footer={
                <Show
                    when={pull()}
                    fallback={
                        <Show
                            when={installed()}
                            fallback={
                                <PaperEffect variant="primary" disabled={fit()?.rating === "too-big"}>
                                    <PaperButton
                                        variant="primary"
                                        disabled={fit()?.rating === "too-big"}
                                        onClick={download}
                                    >
                                        <PaperIcon>download</PaperIcon>
                                        {fit()?.rating === "too-big" ? "Too big for this computer" : "Download"}
                                    </PaperButton>
                                </PaperEffect>
                            }
                        >
                            <PaperButton disabled>
                                <PaperIcon>check</PaperIcon> Downloaded
                            </PaperButton>
                            <Show when={props.onPick}>
                                <PaperEffect variant="primary">
                                    <PaperButton variant="primary" onClick={() => props.onPick!(ref())}>Use this model</PaperButton>
                                </PaperEffect>
                            </Show>
                        </Show>
                    }
                >
                    <PaperButton onClick={cancel}>Cancel download</PaperButton>
                </Show>
            }
        >
            <Show when={model()}>
                <div class={styles.head}>
                    <MakerLogo icon={maker()?.icon} size="large" />
                    <div class={styles.names}>
                        <PaperText weight={700}>{ref()}</PaperText>
                        <PaperText size={2} color="text-muted">
                            {maker()?.name ?? "Unknown maker"}
                        </PaperText>
                    </div>
                    <Show when={capabilities().length > 0}>
                        <div class={styles.caps}>
                            <For each={capabilities()}>
                                {(c) => (
                                    <PaperBadge variant="monochrome" icon={CAPABILITY_LABELS[c]!.icon}>
                                        {CAPABILITY_LABELS[c]!.label}
                                    </PaperBadge>
                                )}
                            </For>
                        </div>
                    </Show>
                </div>

                <PaperText size={2} color="text-subtle">{model()!.description}</PaperText>

                <div class={styles.field}>
                    <PaperText weight={600}>Size</PaperText>
                    <PaperSelectMenu
                        name={`size-${model()!.name}`}
                        aria-label={`${model()!.name} size`}
                        value={selected()?.tag ?? ""}
                        onValueChange={(v) => props.onTagChange(String(v))}
                    >
                        <For each={model()!.tags}>
                            {(t) => {
                                const tFit = () => fitFor(t.bytes, t.context);
                                return (
                                    <PaperSelectMenuItem value={t.tag} icon={<span class={styles.dot} data-rating={tFit().rating} />}>
                                        {t.tag} · {formatBytes(t.bytes)} · {FIT_LABELS[tFit().rating].title}
                                    </PaperSelectMenuItem>
                                );
                            }}
                        </For>
                    </PaperSelectMenu>
                </div>

                <Show
                    when={pull()}
                    fallback={
                        <Show when={fit()}>
                            <FitMeter fit={fit()!} measuredTps={speed()} />
                            <PaperTable>
                                <thead>
                                    <tr>
                                        <th>Statistic</th>
                                        <th>Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>Download size</td>
                                        <td>{formatBytes(selected()!.bytes)}</td>
                                    </tr>
                                    <tr>
                                        <td>Context window</td>
                                        <td>{Math.round(selected()!.context / 1024)}K tokens</td>
                                    </tr>
                                    <tr>
                                        <td>Parameters</td>
                                        <td>{selected()!.tag}</td>
                                    </tr>
                                    <tr>
                                        <td>Maker</td>
                                        <td>{maker()?.name ?? "Unknown"}</td>
                                    </tr>
                                    <tr>
                                        <td>Capabilities</td>
                                        <td>{capabilities().length ? capabilities().map((c) => CAPABILITY_LABELS[c]!.label).join(", ") : "Chat"}</td>
                                    </tr>
                                    <tr>
                                        <td>Memory</td>
                                        <td>
                                            about {formatBytes(fit()!.needBytes)} at a {Math.round(fit()!.contextLength / 1024)}K context
                                            {fit()!.exact ? "" : " (estimate)"}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>Measured speed</td>
                                        <td>{speed() ? `${speed()} tokens/s` : "Not measured yet"}</td>
                                    </tr>
                                </tbody>
                            </PaperTable>
                        </Show>
                    }
                >
                    <div class={styles.progress}>
                        <PaperText weight={600}>Downloading {model()!.name}</PaperText>
                        <PaperProgress
                            value={pull()!.completedBytes}
                            max={Math.max(1, pull()!.totalBytes)}
                            aria-label={`Downloading ${ref()}`}
                        />
                        <PaperText size={2} color="text-muted">
                            {percent()}% · {formatBytes(pull()!.completedBytes)} of {formatBytes(pull()!.totalBytes)}
                        </PaperText>
                    </div>
                </Show>

                <Show when={error()}>
                    <PaperText color="danger" role="alert">{error()}</PaperText>
                </Show>
            </Show>
        </PaperModal>
    );
}
