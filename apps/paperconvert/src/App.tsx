import {
  PaperBadge,
  PaperButton,
  PaperCard,
  PaperEffect,
  PaperFlex,
  PaperIcon,
  PaperInput,
  PaperLink,
  PaperModal,
  PaperProgress,
  PaperProvider,
  PaperSelectMenu,
  PaperSelectMenuItem,
  PaperSettingItem,
  PaperSettingList,
  PaperSpacer,
  PaperText,
  PaperToggle,
  getVarCss,
  PaperAvatar,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "./app.css";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import {
  ALL_FORMATS,
  getAvailableTargets,
} from "./lib/formats";
import {
  convertImage,
  DEFAULT_OPTIONS,
  formatBytes,
  outputFileName,
  savingsPercent,
  type ConvertOptions,
} from "./lib/imageConverter";
import { downloadUrl, makeJob, type ConvertJob } from "./lib/queue";
import {
  getRandomCopy,
  PAPERBOARD_COPIES,
  type PaperboardCopy,
} from "./lib/paperboardCopies";

const ACCEPT =
  "image/*,video/*,audio/*,.png,.jpg,.jpeg,.webp,.avif,.bmp,.gif,.ico,.svg,.mp4,.webm,.mov,.wav,.mp3,.ogg,.csv,.json";

export default function App() {
  const [theme, setTheme] = createSignal<"dark" | "light">(
    window.matchMedia?.("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark",
  );
  const [jobs, setJobs] = createSignal<ConvertJob[]>([]);
  const [dragging, setDragging] = createSignal(false);
  const [convertingAll, setConvertingAll] = createSignal(false);
  const [optionsFor, setOptionsFor] = createSignal<string | null>(null);
  const [powerFor, setPowerFor] = createSignal<string | null>(null);

  let fileInput: HTMLInputElement | undefined;
  let dragDepth = 0;

  const patchJob = (id: string, patch: Partial<ConvertJob>) =>
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const powerJob = createMemo(
    () => jobs().find((j) => j.id === powerFor()) ?? null,
  );
  const allDone = createMemo(
    () => jobs().length > 0 && jobs().every((j) => j.status === "done"),
  );

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.size > 0);
    if (!arr.length) return;
    setJobs((js) => [...arr.map((f) => makeJob(f)), ...js]);
  }

  async function convertOne(id: string) {
    const job = jobs().find((j) => j.id === id);
    if (!job || job.status === "converting") return;
    patchJob(id, { status: "converting", progress: 0.35, error: undefined });

    const pulse = setInterval(() => {
      const j = jobs().find((x) => x.id === id);
      if (!j || j.status !== "converting") return clearInterval(pulse);
      patchJob(id, { progress: Math.min(0.95, j.progress + 0.12) });
    }, 120);

    try {
      const res = await convertImage(job.file, job.options);
      clearInterval(pulse);
      patchJob(id, {
        status: "done",
        progress: 1,
        resultUrl: URL.createObjectURL(res.blob),
        resultBytes: res.toBytes,
        resultW: res.width,
        resultH: res.height,
        elapsedMs: res.elapsedMs,
      });
      setPowerFor(id);
    } catch (e: any) {
      clearInterval(pulse);
      patchJob(id, {
        status: "error",
        progress: 0,
        error: e?.message ?? "Conversion failed.",
      });
    }
  }

  async function convertAll() {
    if (convertingAll()) return;
    setConvertingAll(true);
    try {
      for (const j of jobs()) {
        if (j.status === "queued" || j.status === "error") {
          // eslint-disable-next-line no-await-in-loop
          await convertOne(j.id);
        }
      }
    } finally {
      setConvertingAll(false);
    }
  }

  function downloadJob(id: string) {
    const j = jobs().find((x) => x.id === id);
    if (!j?.resultUrl) return;
    downloadUrl(j.resultUrl, outputFileName(j.file.name, j.target));
  }

  const removeJob = (id: string) =>
    setJobs((js) => {
      const j = js.find((x) => x.id === id);
      if (j) {
        URL.revokeObjectURL(j.previewUrl);
        if (j.resultUrl) URL.revokeObjectURL(j.resultUrl);
      }
      return js.filter((x) => x.id !== id);
    });

  const clearAll = () => {
    jobs().forEach((j) => {
      URL.revokeObjectURL(j.previewUrl);
      if (j.resultUrl) URL.revokeObjectURL(j.resultUrl);
    });
    setJobs([]);
  };

  onMount(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (files.length) addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    onCleanup(() => window.removeEventListener("paste", onPaste));
  });

  return (
    <PaperProvider theme={theme()} styleBody>
      <PaperFlex direction="column" style={{ "min-height": "100vh" }}>
        {/* Topbar */}
        <div class="conv-topbar">
          <PaperFlex
            direction="row"
            align="center"
            justify="space-between"
            fullWidth
            paddingX="double"
            paddingY="half"
            maxWidth={getVarCss("size-panel-wide")}
            style={{
              margin: "0 auto",
              height: getVarCss("size-bar"),
              "box-sizing": "border-box",
            }}
          >
            <PaperFlex direction="row" align="center" gap="threefourths">
              <PaperAvatar src="/logo.png" shape="square" size="medium" />
              <PaperText rounded weight={800} size={5}>
                PaperConvert
              </PaperText>
            </PaperFlex>
            <PaperFlex direction="row" align="center" gap="full">
              <PaperLink
                href="https://paperboard.dev"
                external
                style={{ "text-decoration": "none" }}
              >
                paperboard.dev
              </PaperLink>
              <PaperButton size="tiny"
                icon
                variant="text"
                onClick={() =>
                  setTheme((t) => (t === "dark" ? "light" : "dark"))
                }
                aria-label="Toggle theme"
              >
                {theme() === "dark" ? "dark_mode" : "light_mode"}
              </PaperButton>
            </PaperFlex>
          </PaperFlex>
        </div>

        {/* Main page content */}
        <PaperFlex
          direction="column"
          gap="double"
          style={{
            width: "100%",
            "max-width": getVarCss("size-panel-wide"),
            margin: "0 auto",
            padding: `${getVarCss("uigap-double")}`,
            "box-sizing": "border-box",
            flex: 1,
          }}
        >
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.currentTarget.files) addFiles(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />

          <Show
            when={jobs().length > 0}
            fallback={
              <div
                class={`conv-drop ${dragging() ? "dragging" : ""}`}
                onClick={() => fileInput?.click()}
                onDragEnter={(e) => {
                  e.preventDefault();
                  dragDepth++;
                  setDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  if (--dragDepth <= 0) {
                    dragDepth = 0;
                    setDragging(false);
                  }
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  dragDepth = 0;
                  setDragging(false);
                  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
                }}
              >
                <PaperFlex
                  gap="full"
                  align="center"
                  style={{ padding: `${getVarCss("uigap-triple")} 0` }}
                >
                  <PaperIcon
                    style={{ "font-size": `${getVarCss("icon-size-huge")}`, color: `${getVarCss("primary")}` }}
                    zeroHeight
                  >
                    cloud_upload
                  </PaperIcon>
                  <PaperFlex gap="onefourth" align="center">
                    <PaperText size={6} weight={800}>
                      Drop files here or click to browse
                    </PaperText>
                    <PaperText size={2} color="text-subtle">
                      Images · Video to GIF · Audio to WAV · CSV &amp; JSON
                    </PaperText>
                  </PaperFlex>
                  <PaperEffect>
                    <PaperButton
                      variant="primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInput?.click();
                      }}
                    >
                      <PaperIcon zeroHeight>add</PaperIcon> Select files
                    </PaperButton>
                  </PaperEffect>
                </PaperFlex>
              </div>
            }
          >
            {/* Queue header bar */}
            <PaperFlex
              direction="row"
              justify="space-between"
              align="center"
              fullWidth
            >
              <PaperText size={4} weight={700}>
                {jobs().length} {jobs().length === 1 ? "file" : "files"} in
                queue
              </PaperText>
              <PaperFlex direction="row" gap="half">
                <PaperButton size="tiny"
                  variant="text"
                  onClick={() => fileInput?.click()}
                >
                  <PaperIcon zeroHeight>add</PaperIcon> Add more
                </PaperButton>
                <PaperButton size="tiny" variant="text" onClick={clearAll}>
                  <PaperIcon zeroHeight>delete</PaperIcon> Clear all
                </PaperButton>
              </PaperFlex>
            </PaperFlex>

            {/* Queue list */}
            <PaperFlex direction="column" gap="half" fullWidth>
              <For each={jobs()}>
                {(job) => (
                  <FileRow
                    job={job}
                    onConvert={() => convertOne(job.id)}
                    onDownload={() => downloadJob(job.id)}
                    onOptions={() => setOptionsFor(job.id)}
                    onRemove={() => removeJob(job.id)}
                    onRetarget={(t) =>
                      patchJob(job.id, {
                        target: t,
                        options: { ...job.options, target: t },
                        status: job.status === "done" ? "queued" : job.status,
                        resultUrl: undefined,
                      })
                    }
                  />
                )}
              </For>
            </PaperFlex>

            {/* Bottom action bar */}
            <PaperFlex
              direction="row"
              justify="flex-end"
              align="center"
              gap="half"
              fullWidth
            >
              <PaperEffect>
                <PaperButton
                  variant="success"
                  onClick={convertAll}
                  disabled={convertingAll() || allDone()}
                >
                  <PaperIcon zeroHeight>
                    {convertingAll() ? "hourglass_top" : "bolt"}
                  </PaperIcon>
                  {convertingAll() ? "Converting…" : "Convert all"}
                </PaperButton>
              </PaperEffect>
            </PaperFlex>
          </Show>
        </PaperFlex>

        {/* Options Modal (Config Menu) */}
        <OptionsModal
          job={jobs().find((j) => j.id === optionsFor()) ?? null}
          onClose={() => setOptionsFor(null)}
          onChange={(id, options) =>
            patchJob(id, {
              options,
              target: options.target,
              status: "queued",
              resultUrl: undefined,
            })
          }
        />

        {/* "That's the power of local!" Modal */}
        <PowerModal
          job={powerJob()}
          onClose={() => setPowerFor(null)}
          onDownload={(id) => downloadJob(id)}
        />
      </PaperFlex>
    </PaperProvider>
  );
}

function FileRow(props: {
  job: ConvertJob;
  onConvert: () => void;
  onDownload: () => void;
  onOptions: () => void;
  onRemove: () => void;
  onRetarget: (t: string) => void;
}) {
  return (
    <PaperCard padding="full">
      <PaperFlex
        direction="row"
        align="center"
        justify="space-between"
        gap="full"
        fullWidth
      >
        {/* Left: Thumbnail & Name / Status */}
        <PaperFlex
          direction="row"
          align="center"
          gap="half"
          style={{ flex: 1, "min-width": 0 }}
        >
          <Show
            when={props.job.previewUrl}
            fallback={
              <div
                class="conv-thumb"
                style={{
                  display: "grid",
                  "place-items": "center",
                  color: `${getVarCss("primary")}`,
                }}
              >
                <PaperIcon zeroHeight>
                  {props.job.fromFmt === "wav" || props.job.fromFmt === "mp3" || props.job.fromFmt === "ogg"
                    ? "audio_file"
                    : props.job.fromFmt === "csv" || props.job.fromFmt === "json"
                      ? "data_object"
                      : "movie"}
                </PaperIcon>
              </div>
            }
          >
            <img
              class="conv-thumb"
              src={props.job.previewUrl}
              alt=""
              loading="lazy"
            />
          </Show>
          <PaperFlex gap="onefourth" style={{ flex: 1, "min-width": 0 }}>
            <PaperText weight={700} size={3} truncate>
              {props.job.file.name}
            </PaperText>
            <PaperText size={1} color="text-subtle">
              {formatBytes(props.job.file.size)} ·{" "}
              {props.job.fromFmt.toUpperCase()}
              <Show when={props.job.target === "gif" && props.job.options.reallyGoodGif}>
                {" · "}
                <span style={{ color: `${getVarCss("success")}`, "font-weight": "600" }}>
                  Really Good GIF
                </span>
              </Show>
              <Show when={props.job.status === "done"}>
                {" → "}
                {formatBytes(props.job.resultBytes ?? 0)}
                <Show when={props.job.resultW && props.job.resultH}>
                  {" · "}{props.job.resultW}×{props.job.resultH}
                </Show>
                {" · "}
                {Math.max(1, Math.round(props.job.elapsedMs ?? 0))}ms
              </Show>
              <Show when={props.job.status === "error" && props.job.error}>
                {" · "}
                {props.job.error}
              </Show>
            </PaperText>
            <Show when={props.job.status === "converting"}>
              <PaperProgress
                value={Math.round(props.job.progress * 100)}
                style={{ "margin-top": getVarCss("uigap-onefourth"), width: "100%" }}
              />
            </Show>
          </PaperFlex>
        </PaperFlex>

        {/* Right: Format, Settings, Convert/Save, Status, Close */}
        <PaperFlex
          direction="row"
          align="center"
          gap="half"
          style={{ "flex-shrink": 0 }}
        >
          <PaperIcon
            zeroHeight
            style={{ color: `${getVarCss("text-faint")}` }}
          >
            arrow_forward
          </PaperIcon>
          <PaperSelectMenu
            name={`to-${props.job.id}`}
            value={props.job.target}
            onValueChange={(v) => props.onRetarget(String(v))}
            placeholder="To…"
          >
            <For each={getAvailableTargets(props.job.file)}>
              {(f) => (
                <PaperSelectMenuItem
                  value={f.id}
                  icon={
                    f.category === "video"
                      ? "movie"
                      : f.category === "audio"
                        ? "audio_file"
                        : f.category === "data"
                          ? "data_object"
                          : "image"
                  }
                >
                  {f.label}
                </PaperSelectMenuItem>
              )}
            </For>
          </PaperSelectMenu>

          <PaperButton size="tiny"
            icon
            variant="text"
            onClick={props.onOptions}
            aria-label="Conversion options"
            title="Options"
          >
            settings
          </PaperButton>

          <Show
            when={props.job.status === "done"}
            fallback={
              <PaperEffect>
                <PaperButton
                  variant="primary"
                  onClick={props.onConvert}
                  disabled={props.job.status === "converting"}
                >
                  <PaperIcon zeroHeight>
                    {props.job.status === "converting"
                      ? "hourglass_top"
                      : "autorenew"}
                  </PaperIcon>
                  Convert
                </PaperButton>
              </PaperEffect>
            }
          >
            <PaperEffect>
              <PaperButton variant="success" onClick={props.onDownload}>
                <PaperIcon zeroHeight>download</PaperIcon> Save
              </PaperButton>
            </PaperEffect>
          </Show>

          <Show when={props.job.status === "done"}>
            <PaperBadge variant="success" icon="check">
              Done
            </PaperBadge>
          </Show>
          <Show when={props.job.status === "error"}>
            <PaperBadge variant="danger" icon="error">
              Error
            </PaperBadge>
          </Show>

          <PaperButton size="tiny"
            icon
            variant="text"
            onClick={props.onRemove}
            aria-label="Remove file"
          >
            close
          </PaperButton>
        </PaperFlex>
      </PaperFlex>
    </PaperCard>
  );
}

function OptionsModal(props: {
  job: ConvertJob | null;
  onClose: () => void;
  onChange: (id: string, options: ConvertOptions) => void;
}) {
  const [draft, setDraft] = createSignal<ConvertOptions>({
    ...DEFAULT_OPTIONS,
  });

  createEffect(() => {
    const j = props.job;
    if (j) {
      setDraft({ ...j.options });
    }
  });

  const updateDraft = (patch: Partial<ConvertOptions>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };

  const isLossy = () => {
    const t = draft().target;
    return t === "jpg" || t === "webp" || t === "avif" || t === "mp4" || t === "webm";
  };

  const needsBg = () => {
    const t = draft().target;
    return t === "jpg" || t === "bmp";
  };

  const handleApply = () => {
    const j = props.job;
    if (j) {
      props.onChange(j.id, draft());
    }
    props.onClose();
  };

  return (
    <PaperModal
      open={props.job !== null}
      onClose={props.onClose}
      title={`Options: ${props.job?.file.name ?? ""}`}
      size="medium"
      noPadding
      footer={
        <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
          <PaperButton variant="text" onClick={props.onClose}>
            Cancel
          </PaperButton>
          <PaperEffect>
            <PaperButton variant="primary" onClick={handleApply}>
              <PaperIcon zeroHeight>check</PaperIcon> Apply
            </PaperButton>
          </PaperEffect>
        </PaperFlex>
      }
    >
      <Show when={props.job}>
        <PaperSettingList autoHeight>
          <PaperSettingItem
            title="Output Format"
            description="Target format for encoding"
          >
            <PaperSelectMenu
              name="opt-target"
              value={draft().target}
              onValueChange={(v) => updateDraft({ target: String(v) })}
            >
              <For each={getAvailableTargets(props.job!.file)}>
                {(f) => (
                  <PaperSelectMenuItem
                    value={f.id}
                    icon={
                      f.category === "video"
                        ? "movie"
                        : f.category === "audio"
                          ? "audio_file"
                          : f.category === "data"
                            ? "data_object"
                            : "image"
                    }
                  >
                    {f.label}
                  </PaperSelectMenuItem>
                )}
              </For>
            </PaperSelectMenu>
          </PaperSettingItem>

          {/* Really Good GIF Encoder Toggle */}
          <Show when={draft().target === "gif"}>
            <PaperSettingItem
              title="Really Good GIF Encoder"
              description={
                draft().reallyGoodGif
                  ? "Tenor-grade 480px bounds, 15 FPS rate, and 128-color palette to keep file size small"
                  : "Disabled: converts with standard uncompressed settings and user dimensions"
              }
            >
              <PaperToggle
                name="reallyGoodGif"
                checked={draft().reallyGoodGif}
                onChange={(v) => updateDraft({ reallyGoodGif: v })}
              />
            </PaperSettingItem>

            <Show when={!draft().reallyGoodGif}>
              <PaperSettingItem
                title="Color Palette"
                description="Number of indexed colors per frame"
              >
                <PaperSelectMenu
                  name="gifColors"
                  value={draft().gifColors ?? 256}
                  onValueChange={(v) => updateDraft({ gifColors: Number(v) })}
                >
                  <PaperSelectMenuItem value={256}>256 Colors (Standard)</PaperSelectMenuItem>
                  <PaperSelectMenuItem value={128}>128 Colors (Compact)</PaperSelectMenuItem>
                  <PaperSelectMenuItem value={64}>64 Colors (Lightweight)</PaperSelectMenuItem>
                  <PaperSelectMenuItem value={32}>32 Colors (Retro)</PaperSelectMenuItem>
                </PaperSelectMenu>
              </PaperSettingItem>

              <PaperSettingItem
                title="Frame Rate (FPS)"
                description="Frames per second for animation"
              >
                <PaperSelectMenu
                  name="gifFps"
                  value={draft().gifFps ?? 15}
                  onValueChange={(v) => updateDraft({ gifFps: Number(v) })}
                >
                  <PaperSelectMenuItem value={10}>10 FPS (Low bandwidth)</PaperSelectMenuItem>
                  <PaperSelectMenuItem value={15}>15 FPS (Standard GIF)</PaperSelectMenuItem>
                  <PaperSelectMenuItem value={24}>24 FPS (Cinematic)</PaperSelectMenuItem>
                  <PaperSelectMenuItem value={30}>30 FPS (Smooth)</PaperSelectMenuItem>
                </PaperSelectMenu>
              </PaperSettingItem>
            </Show>
          </Show>

          {/* Video Options */}
          <Show when={draft().target === "mp4" || draft().target === "webm"}>
            <PaperSettingItem
              title="Mute Audio"
              description="Strip audio track from the transcoded video"
            >
              <PaperToggle
                checked={draft().muteAudio ?? false}
                onChange={(v) => updateDraft({ muteAudio: v })}
              />
            </PaperSettingItem>

            <PaperSettingItem
              title="Video Frame Rate"
              description="Frames per second for video encoding"
            >
              <PaperSelectMenu
                name="videoFps"
                value={draft().videoFps ?? 30}
                onValueChange={(v) => updateDraft({ videoFps: Number(v) })}
              >
                <PaperSelectMenuItem value={24}>24 FPS (Cinematic)</PaperSelectMenuItem>
                <PaperSelectMenuItem value={30}>30 FPS (Standard)</PaperSelectMenuItem>
                <PaperSelectMenuItem value={60}>60 FPS (Smooth)</PaperSelectMenuItem>
              </PaperSelectMenu>
            </PaperSettingItem>
          </Show>

          <Show when={isLossy()}>
            <PaperSettingItem
              title={`Quality (${draft().quality}%)`}
              description="Adjust compression level (1-100)"
            >
              <PaperFlex direction="row" align="center" gap="half">
                <PaperInput
                  type="number"
                  compact
                  min={1}
                  max={100}
                  value={draft().quality}
                  onInput={(e) =>
                    updateDraft({
                      quality: Math.min(
                        100,
                        Math.max(1, Number(e.currentTarget.value) || 85),
                      ),
                    })
                  }
                  style={{ width: getVarCss("size-field-small") }}
                />
                <PaperBadge variant="primary">
                  {draft().quality >= 90
                    ? "High"
                    : draft().quality >= 75
                      ? "Medium"
                      : "Low"}
                </PaperBadge>
              </PaperFlex>
            </PaperSettingItem>
          </Show>

          <PaperSettingItem
            title="Resize Mode"
            description="Scale dimensions while preserving or stretching aspect ratio"
          >
            <PaperSelectMenu
              name="opt-resize"
              value={draft().resizeMode}
              onValueChange={(v) =>
                updateDraft({
                  resizeMode: v as ConvertOptions["resizeMode"],
                })
              }
            >
              <PaperSelectMenuItem value="original" icon="photo">
                Original size
              </PaperSelectMenuItem>
              <PaperSelectMenuItem value="width" icon="swap_horiz">
                Fit to width
              </PaperSelectMenuItem>
              <PaperSelectMenuItem value="height" icon="swap_vert">
                Fit to height
              </PaperSelectMenuItem>
              <PaperSelectMenuItem value="exact" icon="crop">
                Exact dimensions
              </PaperSelectMenuItem>
              <PaperSelectMenuItem value="percent" icon="percent">
                Percentage
              </PaperSelectMenuItem>
            </PaperSelectMenu>
          </PaperSettingItem>

          <Show
            when={
              draft().resizeMode === "width" || draft().resizeMode === "exact"
            }
          >
            <PaperSettingItem
              title="Target Width"
              description="Output width in pixels"
            >
              <PaperInput
                type="number"
                compact
                placeholder="Width (px)"
                value={draft().width ?? ""}
                min={1}
                max={16000}
                onInput={(e) =>
                  updateDraft({
                    width: Number(e.currentTarget.value) || undefined,
                  })
                }
                style={{ width: getVarCss("size-field-medium") }}
              />
            </PaperSettingItem>
          </Show>

          <Show
            when={
              draft().resizeMode === "height" ||
              draft().resizeMode === "exact"
            }
          >
            <PaperSettingItem
              title="Target Height"
              description="Output height in pixels"
            >
              <PaperInput
                type="number"
                compact
                placeholder="Height (px)"
                value={draft().height ?? ""}
                min={1}
                max={16000}
                onInput={(e) =>
                  updateDraft({
                    height: Number(e.currentTarget.value) || undefined,
                  })
                }
                style={{ width: getVarCss("size-field-medium") }}
              />
            </PaperSettingItem>
          </Show>

          <Show when={draft().resizeMode === "percent"}>
            <PaperSettingItem
              title="Scale Percent"
              description="1% to 400% of original dimensions"
            >
              <PaperInput
                type="number"
                compact
                placeholder="%"
                value={draft().percent ?? 100}
                min={1}
                max={400}
                onInput={(e) =>
                  updateDraft({
                    percent: Number(e.currentTarget.value) || 100,
                  })
                }
                style={{ width: getVarCss("size-field-medium") }}
              />
            </PaperSettingItem>
          </Show>

          <Show when={needsBg()}>
            <PaperSettingItem
              title="Background Color"
              description="Replaces transparency for formats without alpha channel"
            >
              <PaperFlex direction="row" align="center" gap="half">
                <PaperInput
                  compact
                  value={draft().background}
                  onInput={(e) =>
                    updateDraft({ background: e.currentTarget.value })
                  }
                  style={{ width: getVarCss("size-field-medium") }}
                />
                <input
                  type="color"
                  class="conv-color-input"
                  value={draft().background}
                  onInput={(e) =>
                    updateDraft({ background: e.currentTarget.value })
                  }
                />
              </PaperFlex>
            </PaperSettingItem>
          </Show>

          <PaperSettingItem
            title="Auto-rotate"
            description="Rotate image automatically according to EXIF data"
          >
            <PaperToggle
              checked={draft().autoRotate}
              onChange={(v) => updateDraft({ autoRotate: v })}
            />
          </PaperSettingItem>

          <PaperSettingItem
            title="Progressive"
            description="Interlaced / progressive encoding for web streaming"
          >
            <PaperToggle
              checked={draft().progressive}
              onChange={(v) => updateDraft({ progressive: v })}
            />
          </PaperSettingItem>
        </PaperSettingList>
      </Show>
    </PaperModal>
  );
}

function PowerModal(props: {
  job: ConvertJob | null;
  onClose: () => void;
  onDownload: (id: string) => void;
}) {
  const [copy, setCopy] = createSignal<PaperboardCopy>(getRandomCopy());

  createEffect(() => {
    if (props.job) {
      setCopy(getRandomCopy());
    }
  });

  return (
    <PaperModal
      open={props.job !== null}
      onClose={props.onClose}
      title="Conversion completed!"
      size="medium"
      footer={
        <Show when={props.job}>
          {(j) => (
            <PaperFlex
              direction="row"
              justify="space-between"
              align="center"
              fullWidth
            >
              <a
                href="https://paperboard.dev"
                target="_blank"
                rel="noreferrer"
                style={{ "text-decoration": "none" }}
              >
                <PaperButton variant="text">
                  Discover Paperboard{" "}
                  <PaperIcon zeroHeight>open_in_new</PaperIcon>
                </PaperButton>
              </a>
              <PaperEffect>
                <PaperButton
                  variant="success"
                  onClick={() => props.onDownload(j().id)}
                >
                  <PaperIcon zeroHeight>download</PaperIcon> Download
                </PaperButton>
              </PaperEffect>
            </PaperFlex>
          )}
        </Show>
      }
    >
      <Show when={props.job}>
        {(j) => (
          <PaperFlex
            gap="double"
            align="center"
            style={{
              "text-align": "center",
              width: "100%",
              padding: `${getVarCss("uigap-half")} 0 ${getVarCss("uigap")}`,
            }}
          >
            {/* The copy is the centerpiece */}
            <PaperFlex
              gap="half"
              align="center"
              style={{ "max-width": getVarCss("size-panel-small"), width: "100%" }}
            >
              <PaperText
                size={7}
                weight={800}
                rounded
                style={{ "line-height": 1.25, "text-wrap": "balance" }}
              >
                {copy().tagline}
              </PaperText>
              <PaperText
                size={3}
                color="text-subtle"
                style={{ "line-height": 1.6, "text-wrap": "pretty" }}
              >
                {copy().text}
              </PaperText>
            </PaperFlex>

            {/* Subtle, understated conversion summary */}
            <PaperCard
              paddingX="full"
              paddingY="half"
              style={{ "border-radius": `${getVarCss("border-radius-pill")}` }}
            >
              <PaperFlex
                direction="row"
                align="center"
                justify="center"
                gap="half"
                wrap
                style={{
                  "font-size": `${getVarCss("text-size-2")}`,
                  color: `${getVarCss("text-subtle")}`,
                }}
              >
                <span>
                  Converted in{" "}
                  <strong style={{ color: `${getVarCss("text")}` }}>
                    {Math.max(1, Math.round(j().elapsedMs ?? 0))} ms
                  </strong>
                </span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span>
                  <strong style={{ color: `${getVarCss("text")}` }}>
                    0 B
                  </strong>{" "}
                  uploaded
                </span>
                <Show when={(j().resultBytes ?? 0) < j().file.size}>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <span
                    style={{
                      color: `${getVarCss("success")}`,
                      "font-weight": "700",
                    }}
                  >
                    -{savingsPercent(j().file.size, j().resultBytes ?? 0)}%
                  </span>
                </Show>
                <span style={{ opacity: 0.4 }}>·</span>
                <span>
                  {formatBytes(j().file.size)} →{" "}
                  {formatBytes(j().resultBytes ?? 0)}
                </span>
                <PaperBadge
                  variant="monochrome"
                  style={{
                    "font-size": getVarCss("rail-label-size"),
                    padding: `0 ${getVarCss("uigap-half")}`,
                    "margin-left": getVarCss("uigap-onefourth"),
                  }}
                >
                  {j().target.toUpperCase()}
                </PaperBadge>
              </PaperFlex>
            </PaperCard>
          </PaperFlex>
        )}
      </Show>
    </PaperModal>
  );
}
