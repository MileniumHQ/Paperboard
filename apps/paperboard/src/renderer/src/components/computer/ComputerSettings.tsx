import { type Component, Index, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperPage,
    PaperPageHeader,
    PaperSectionHeader,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
} from "@mileniumhq/paperui";
import { computerAddress, type ComputerInfo } from "../../lib/shell";
import { computerIcon } from "./computerIcon";
import BackupLocations from "../backups/BackupLocations";
import ComputerPorts from "./ComputerPorts";
import { computerFacts } from "./osBrand";

export interface ComputerSettingsProps {
    computer?: ComputerInfo;
    /** the page is in view: what it shows is read again each time it comes into view */
    shown: boolean;
    /** opens the Forget Computer dialog, the same one the rail's menu opens */
    onForget: () => void;
    onChangeName: () => void;
}

const ComputerSettings: Component<ComputerSettingsProps> = (props) => {
    const isLocal = () => Boolean(props.computer?.isLocal);
    const address = () => (props.computer ? computerAddress(props.computer) : undefined);

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
                    {(computer) => (
                        <PaperFlex direction="column" gap="half" fullWidth>
                            <PaperSectionHeader icon="info" title="System" />
                            <PaperSettingList autoHeight>
                                <Index each={computerFacts(computer())}>
                                    {(row) => (
                                        <PaperSettingItem title={row().title}>
                                            <PaperText preset="label">{row().value}</PaperText>
                                        </PaperSettingItem>
                                    )}
                                </Index>
                            </PaperSettingList>
                        </PaperFlex>
                    )}
                </Show>
                <Show when={props.computer}>
                    {(computer) => <BackupLocations computerId={computer().id} computerName={computer().name || "This Computer"} shown={props.shown} />}
                </Show>
                <Show when={props.computer}>
                    {(computer) => <ComputerPorts computerId={computer().id} shown={props.shown} />}
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
