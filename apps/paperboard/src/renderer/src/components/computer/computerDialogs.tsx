import { createSignal } from "solid-js";
import { useContextMenuState } from "@mileniumhq/paperui";
import type { ComputerInfo } from "../../lib/shell";
import ComputerContextMenu from "./ComputerContextMenu";
import ForgetComputerModal from "./ForgetComputerModal";
import RenameComputerModal from "./RenameComputerModal";

export interface ComputerDialogsOptions {
    computers: () => readonly ComputerInfo[];
    /** the computer's panels with unsaved work have their say; false when one chose to stay */
    mayLeaveComputer: (compId: string) => Promise<boolean>;
    openComputerInfo: (compId: string) => void;
    /** rejects with why it couldn't; the dialog stays open showing it */
    forgetComputer: (compId: string, evenIfUntold: boolean) => Promise<string | null>;
}

// A computer's right-click menu on the rail, and the Change Name and Forget
// Computer dialogs it (and the computer's info page, and the can't-reach
// dialog) opens. `Dialogs` renders them; the rest opens them.
export function createComputerDialogs(options: ComputerDialogsOptions) {
    const menu = useContextMenuState();
    const [menuComputerId, setMenuComputerId] = createSignal<string | null>(null);
    const [renameComputerId, setRenameComputerId] = createSignal<string | null>(null);
    const [forgetComputerId, setForgetComputerId] = createSignal<string | null>(null);
    const computerById = (id: string | null) => options.computers().find((c) => c.id === id);

    const openMenu = (compId: string, e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuComputerId(compId);
        menu.openAtMouse(e);
    };

    // Forget Computer opens once the computer's panels with unsaved work have had their say
    const openForget = async (compId: string) => {
        if (await options.mayLeaveComputer(compId)) setForgetComputerId(compId);
    };

    /** a menu item: the menu closes, then it acts on the computer it was opened on */
    const fromMenu = (act: (compId: string) => void) => () => {
        menu.close();
        const compId = menuComputerId();
        setMenuComputerId(null);
        if (compId) act(compId);
    };

    const Dialogs = () => (
        <>
            <ComputerContextMenu
                menu={menu}
                isLocal={Boolean(computerById(menuComputerId())?.isLocal)}
                onInfo={fromMenu(options.openComputerInfo)}
                onRename={fromMenu(setRenameComputerId)}
                onForget={fromMenu((compId) => void openForget(compId))}
            />
            <RenameComputerModal computer={computerById(renameComputerId())} onClose={() => setRenameComputerId(null)} />
            <ForgetComputerModal
                computer={computerById(forgetComputerId())}
                onClose={() => setForgetComputerId(null)}
                onForget={options.forgetComputer}
            />
        </>
    );

    return { openMenu, openForget, openRename: (compId: string) => setRenameComputerId(compId), Dialogs };
}
