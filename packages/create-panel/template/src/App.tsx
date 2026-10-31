// The panel is a menu and the page it picked. PaperPanel lays them out side
// by side, and on a phone turns the menu into the first screen.
import { createSignal } from "solid-js";
import {
    PaperPanel,
    PaperMenu,
    PaperMenuItem,
    PaperInterfaceGroup,
    PaperInterfaceItem,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import CounterPage from "./pages/CounterPage";
import NotesPage from "./pages/NotesPage";
// @if service
import ServicePage from "./pages/ServicePage";
// @endif

export default function App() {
    const [activeTab, setActiveTab] = createSignal("counter");

    return (
        <PaperPanel>
            <PaperMenu
                name="starter-menu"
                value={activeTab()}
                onValueChange={(val) => setActiveTab(String(val))}
            >
                <PaperMenuItem value="counter" icon="add">
                    Counter
                </PaperMenuItem>
                <PaperMenuItem value="notes" icon="edit">
                    Notes
                </PaperMenuItem>
                {/* @if service */}
                <PaperMenuItem value="service" icon="sync_alt">
                    Service
                </PaperMenuItem>
                {/* @endif */}
            </PaperMenu>

            <PaperInterfaceGroup value={activeTab()}>
                <PaperInterfaceItem value="counter">
                    <CounterPage />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="notes">
                    <NotesPage />
                </PaperInterfaceItem>
                {/* @if service */}
                <PaperInterfaceItem value="service">
                    <ServicePage />
                </PaperInterfaceItem>
                {/* @endif */}
            </PaperInterfaceGroup>
        </PaperPanel>
    );
}
