import { type Component } from "solid-js";
import { PaperText, getVarCss } from "@paperboard-dev/paperui";

const TopBar: Component = () => {
    return (
        <header
            style={{
                height: "38px",
                width: "100%",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "-webkit-app-region": "drag",
                "user-select": "none",
                background: getVarCss("background-back"),
                "border-bottom": `${getVarCss("border-width")} solid ${getVarCss("medium-border")}`,
                position: "relative",
                "flex-shrink": 0,
                "z-index": 2000,
            }}
        >
            <PaperText
                weight={800}
                size={2}
                color="light-text"
                style={{ "pointer-events": "none" }}
            >
                Paperboard
            </PaperText>
        </header>
    );
};

export default TopBar;
