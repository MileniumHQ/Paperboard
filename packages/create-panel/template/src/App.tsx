import { createSignal } from "solid-js";
import {
    PaperFlex,
    PaperMenu,
    PaperMenuItem,
    PaperInterfaceGroup,
    PaperInterfaceItem,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "./style.css";
import CounterPage from "./pages/CounterPage";
import NotesPage from "./pages/NotesPage";
import EchoPage from "./pages/EchoPage";

export default function App() {
    const [activeTab, setActiveTab] = createSignal("counter");

    return (
        <PaperFlex fullWidth fullHeight direction="row">
            <PaperMenu
                name="starter-menu"
                spacing="half"
                value={activeTab()}
                onValueChange={(val) => setActiveTab(String(val))}
            >
                <PaperMenuItem value="counter" icon="add">
                    Counter
                </PaperMenuItem>
                <PaperMenuItem value="notes" icon="edit">
                    Notes
                </PaperMenuItem>
                <PaperMenuItem value="echo" icon="chat">
                    Echo
                </PaperMenuItem>
            </PaperMenu>
            <PaperInterfaceGroup
                value={activeTab()}
                style={{ flex: 1, height: "100%", "min-height": 0, overflow: "auto" }}
            >
                <PaperInterfaceItem value="counter">
                    <CounterPage />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="notes">
                    <NotesPage />
                </PaperInterfaceItem>
                <PaperInterfaceItem value="echo">
                    <EchoPage />
                </PaperInterfaceItem>
            </PaperInterfaceGroup>
        </PaperFlex>
    );
}
