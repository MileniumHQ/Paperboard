// The picture on a panel's block. A block dragged from the Library keeps the
// icon it was dragged with; one a program added (add-flow) has none saved
// and shows its panel's icon from where every panel keeps it.
import { panelAssetUrl } from "@mileniumhq/paperapi";

export function blockIconSrc(block: { panelId: string; iconSrc?: string }): string | undefined {
    if (block.iconSrc) return block.iconSrc;
    // builtin blocks draw their own symbol from the action's icon
    if (block.panelId.startsWith("builtin.")) return undefined;
    return panelAssetUrl(block.panelId, "branding/icon.png");
}
