// Build-time values electron-vite reads from apps/paperboard/.env.local
interface ImportMetaEnv {
    readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string;
    readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string;
}
