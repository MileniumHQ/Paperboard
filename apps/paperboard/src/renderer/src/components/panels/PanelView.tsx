import { PaperFlex, getVarCss } from "@paperboard-dev/paperui";
import { type Component, createSignal, For } from "solid-js";

export interface PanelViewProps {
    activePanel: string;
    activeComputerId: string;
    openedPanels: string[];
    reloadTokens?: Record<string, number>;
}

const PanelView: Component<PanelViewProps> = (props) => {
    const [loadedPanels, setLoadedPanels] = createSignal<
        Record<string, boolean>
    >({});

    const handleLoad = (key: string) => {
        setLoadedPanels((prev) => ({ ...prev, [key]: true }));
    };

    return (
        <PaperFlex
            direction="column"
            fullWidth
            fullHeight
            background="frontest"
            style={{
                flex: "1",
                position: "relative",
                overflow: "hidden",
            }}
        >
            <For each={props.openedPanels}>
                {(key) => {
                    const [frameCompId, panelId] = key.split("::");
                    // Read props inline; capturing them freezes stale values
                    // (Solid props are getters)
                    const isCurrent = () =>
                        frameCompId === props.activeComputerId &&
                        props.activePanel === panelId;
                    const isLoaded = () => Boolean(loadedPanels()[key]);
                    const reloadToken = () => props.reloadTokens?.[key] || 0;

                    return (
                        <iframe
                            data-panel-key={key}
                            data-panel-id={panelId}
                            data-computer-id={frameCompId}
                            src={`panel://${frameCompId}.${panelId}/${reloadToken() ? `?_r=${reloadToken()}` : ""}`}
                            // Panels need scripts + same-origin storage; popups omitted
                            sandbox="allow-scripts allow-same-origin allow-forms"
                            onLoad={() => handleLoad(key)}
                            style={{
                                width: "100%",
                                height: "100%",
                                position: "absolute",
                                inset: "0",
                                border: "none",
                                "border-left": `${getVarCss("border-width")} solid ${getVarCss("medium-border")}`,
                                "box-sizing": "border-box",
                                display: isCurrent() ? "block" : "none",
                                visibility: isLoaded() ? "visible" : "hidden",
                            }}
                            title={panelId}
                        />
                    );
                }}
            </For>
        </PaperFlex>
    );
};

export default PanelView;
