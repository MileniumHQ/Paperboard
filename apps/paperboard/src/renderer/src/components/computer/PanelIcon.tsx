import type { Component } from "solid-js";
import { PaperIcon } from "@mileniumhq/paperui";
import type { PanelItem } from "@mileniumhq/paperapi";
import { panelUrl } from "../../lib/shell";
import styles from "./panelIcon.module.css";

// A panel's icon wherever the shell lists or heads it: a file in the panel
// (its manifest's icon names one, "icon.png"), else the Material symbol the
// manifest names, else a generic one. The panel's name is always beside it,
// so the icon itself says nothing to assistive technology.
const PanelIcon: Component<{ computerId: string; panel?: PanelItem }> = (props) => {
    const file = () => (props.panel?.icon?.includes(".") ? panelUrl(props.computerId, props.panel.id, props.panel.icon) : undefined);
    return (
        <PaperIcon src={file()} alt="" class={styles.rounded}>
            {file() ? undefined : props.panel?.icon || "dashboard"}
        </PaperIcon>
    );
};

export default PanelIcon;
