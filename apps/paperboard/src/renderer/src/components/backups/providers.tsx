// The kinds of backup location a computer can add. Each provider names its
// form and how to connect it; the add-location window lists them in order,
// so a new kind is one more entry here.
import type { JSX } from "solid-js";
import { PaperIcon, getVarCss } from "@mileniumhq/paperui";
import { backupLocationsApi, type BackupLocation } from "@mileniumhq/paperapi";
import { shellIpc } from "../../lib/shell";
import googleDriveLogo from "../../assets/providers/google-drive.svg";

export interface ProviderField {
    key: string;
    label: string;
    placeholder?: string;
    secret?: boolean;
}

export interface ProviderToggle {
    key: string;
    label: string;
    description: string;
}

export interface BackupProvider {
    kind: Exclude<BackupLocation["kind"], "local">;
    name: string;
    description?: string;
    /** a short paragraph shown above the form */
    intro?: string;
    /** the location's name when the provider has no Name field */
    defaultLabel?: string;
    fields: readonly ProviderField[];
    toggles?: readonly ProviderToggle[];
    /** connecting signs in through a browser on this machine, which browser mode cannot host */
    needsDesktopApp?: boolean;
    submitLabel: string;
    busyLabel: string;
    connect: (values: Record<string, string>, toggles: Record<string, boolean>, computerId: string) => Promise<unknown>;
}

function S3Logo(): JSX.Element {
    // a bucket: the S3 kind covers AWS, R2, B2 and MinIO, so no one brand's mark
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "100%", height: "100%" }}>
            <ellipse cx="12" cy="6" rx="8" ry="2.6" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path d="M4 6l1.9 12.6c.3 1.9 2.9 3 6.1 3s5.8-1.1 6.1-3L20 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
            <path d="M5.2 11.2c1.5 1 3.9 1.6 6.8 1.6s5.3-.6 6.8-1.6" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.55" />
        </svg>
    );
}

/** A location kind's logo, sized to the icon slot it sits in. */
export function LocationLogo(props: { kind: BackupLocation["kind"]; size?: "small" | "medium" | "large" }): JSX.Element {
    const size = () => getVarCss(`icon-size-${props.size ?? "medium"}`);
    const box = (): JSX.CSSProperties => ({ width: size(), height: size(), display: "inline-flex", "flex-shrink": 0 });
    if (props.kind === "gdrive") return <img src={googleDriveLogo} alt="" style={{ ...box(), "object-fit": "contain" }} />;
    if (props.kind === "s3") return <span style={{ ...box(), color: getVarCss("primary") }}><S3Logo /></span>;
    return <PaperIcon style={{ "font-size": size(), color: getVarCss("primary") }}>computer</PaperIcon>;
}

export const BACKUP_PROVIDERS: readonly BackupProvider[] = [
    {
        kind: "gdrive",
        name: "Google Drive",
        description: "Save backups to your Google account",
        intro: 'Paperboard keeps backups in a "Paperboard Backups" folder in your Drive and can\'t see your other files.',
        defaultLabel: "Google Drive",
        fields: [],
        needsDesktopApp: true,
        submitLabel: "Sign In With Google",
        busyLabel: "Waiting for Google...",
        connect: (v, _t, computerId) =>
            shellIpc().invoke("backup-gdrive-connect", { computerId, label: v.label ?? "" }),
    },
    {
        kind: "s3",
        name: "S3 bucket",
        fields: [
            { key: "label", label: "Name", placeholder: "Offsite bucket" },
            { key: "endpoint", label: "Server address", placeholder: "https://s3.us-east-1.amazonaws.com" },
            { key: "region", label: "Region", placeholder: "us-east-1" },
            { key: "bucket", label: "Bucket name", placeholder: "my-backups" },
            { key: "prefix", label: "Folder (optional)", placeholder: "paperboard" },
            { key: "accessKeyId", label: "Access key ID" },
            { key: "secretAccessKey", label: "Secret access key", secret: true },
        ],
        toggles: [{ key: "pathStyle", label: "Self-hosted server", description: "Turn on for MinIO and other servers you run yourself" }],
        submitLabel: "Add Bucket",
        busyLabel: "Checking...",
        connect: (v, t, computerId) =>
            backupLocationsApi.add(
                { kind: "s3", label: v.label ?? "", endpoint: v.endpoint ?? "", region: v.region ?? "", bucket: v.bucket ?? "", prefix: v.prefix ?? "", accessKeyId: v.accessKeyId ?? "", secretAccessKey: v.secretAccessKey ?? "", pathStyle: Boolean(t.pathStyle) },
                computerId,
            ),
    },
];
