import { type Component, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperPage,
    PaperPageHeader,
} from "@mileniumhq/paperui";
import type { ComputerItem } from "../../App";
import { computerIcon } from "./computerIcon";
import BackupLocations from "../backups/BackupLocations";
import ComputerPorts from "./ComputerPorts";

export interface ComputerSettingsProps {
    computer?: ComputerItem;
    /** opens the Forget Computer dialog, the same one the rail's menu opens */
    onForget: () => void;
    onChangeName: () => void;
}

const ComputerSettings: Component<ComputerSettingsProps> = (props) => {
    const isLocal = () => Boolean(props.computer?.isLocal);
    const address = () => {
        const host = props.computer?.networkAddress || props.computer?.host || "127.0.0.1";
        return isLocal() ? host : `${host}:${props.computer?.port || 45464}`;
    };

    return (
        <PaperPage>
            <PaperPageHeader
                icon={computerIcon({ name: props.computer?.name, isLocal: isLocal() })}
                title={props.computer?.name || "This Computer"}
                subtitle={address()}
            >
                <PaperButton onClick={() => props.onChangeName()}>
                    <PaperIcon>edit</PaperIcon>
                    Change Name
                </PaperButton>
            </PaperPageHeader>

            <PaperFlex direction="column" gap="double" fullWidth>
                <Show when={props.computer}>
                    {(computer) => <BackupLocations computerId={computer().id} computerName={computer().name || "This Computer"} />}
                </Show>
                <Show when={props.computer}>
                    {(computer) => <ComputerPorts computerId={computer().id} />}
                </Show>

                <Show when={!isLocal()}>
                    <PaperFlex direction="row" justify="flex-start">
                        <PaperButton variant="danger" onClick={() => props.onForget()}>
                            Forget Computer
                        </PaperButton>
                    </PaperFlex>
                </Show>
            </PaperFlex>
        </PaperPage>
    );
};

export default ComputerSettings;
