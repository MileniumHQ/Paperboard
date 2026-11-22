import styles from "./viewers.module.css";
import { PaperEmptyState } from "../../../components/PaperEmptyState";

/**
 * Why a file isn't shown, on a sheet of its own: a preview may sit on a
 * modal's scrim, where bare text would be lost.
 */
export function Failure(props: { title: string; icon?: string; alert?: boolean }) {
    return (
        <div class={`${styles.sheet} ${styles.message}`}>
            <PaperEmptyState icon={props.icon ?? "error"} title={props.title} role={props.alert === false ? undefined : "alert"} />
        </div>
    );
}
