import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
    PaperVideo,
} from "@mileniumhq/paperui";

const sample = "https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.360p.vp9.webm";

export default function PaperVideoDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperVideo</PaperText>
            <PaperText preset="body" as="p">
                PaperVideo is a video player with the controls of <PaperLink href="/docs/paperui/paperaudio/">PaperAudio</PaperLink> under the picture.
                Use it when a panel plays back a clip, a recording, or a file the user picked.
                It brings its own play button, seek line, time readout, volume, full screen, playback speed, and loop.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass the video URL in <PaperCode>src</PaperCode>.
                Set <PaperCode>label</PaperCode> when the page holds more than one player, so each group has its own name for assistive technology.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperVideo src={sample} label="Sample" />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperVideo } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperVideo
                src="https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.360p.vp9.webm"
                label="Sample"
            />
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperVideoProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> except <PaperCode>onError</PaperCode>, which has a different signature.
                Every other prop lands on the root <PaperCode>div</PaperCode>, after its <PaperCode>role="group"</PaperCode> and <PaperCode>aria-label</PaperCode>, so you can override both.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>src</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required, no default</td>
                        <td>URL of the video. Changing it resets the player and loads the new video.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"Video"</PaperCode></td>
                        <td>Accessible name of the player group.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>poster</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>URL of a picture shown before playback starts.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>preload</PaperCode></td>
                        <td><PaperCode>"none" | "metadata" | "auto"</PaperCode></td>
                        <td><PaperCode>"metadata"</PaperCode></td>
                        <td>Forwarded to the video element.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onError</PaperCode></td>
                        <td><PaperCode>(message: string) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the message the player shows when loading or playback fails.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid class props</td>
                        <td>No default</td>
                        <td>Added to the root element. A class is also how a caller sets <PaperCode>--paper-video-max-height</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="size">Size</PaperText>
            <PaperTextList>
                <li>The player is as wide as its picture, up to its container.</li>
                <li>It is never narrower than <PaperCode>--paper-size-card-min</PaperCode>, so the controls always fit. A narrower picture sits in the middle of the stage.</li>
                <li>The picture keeps its shape. It is scaled down to fit both the width and the height, and never taller than <PaperCode>--paper-video-max-height</PaperCode>.</li>
                <li><PaperCode>--paper-video-max-height</PaperCode> defaults to <PaperCode>--paper-size-panel-height-large</PaperCode>. In full screen the limit is removed and the picture fills the screen.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="controls">Controls</PaperText>
            <PaperText preset="body" as="p">
                The bar under the picture uses the same controls as PaperAudio, with a seek line in place of the waveform.
            </PaperText>
            <PaperTextList>
                <li>Pressing the picture plays or pauses the video. Before playback starts, a play icon is drawn over it. For keys and screen readers, the play button in the bar is the one to use.</li>
                <li>The play button toggles play and pause. It is disabled while the player shows an error.</li>
                <li>The seek line is a range input named <PaperCode>Seek</PaperCode>. It is disabled until the duration is known.</li>
                <li>The time beside the line shows the length until playback starts, then the position.</li>
                <li>The speaker button mutes and unmutes. Hovering or focusing it opens a volume slider.</li>
                <li>The full screen button makes the player fill the screen, and exits it again. It is shown only when the browser can do either.</li>
                <li>The options button opens a menu with <PaperCode>Playback speed</PaperCode> (0.5x, 0.75x, Normal, 1.25x, 1.5x, 2x) and <PaperCode>Loop</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="fullscreen">Full screen</PaperText>
            <PaperText preset="body" as="p">
                Where the browser supports it, the player element itself goes full screen, so the controls stay under the picture.
                The iPhone has no element full screen, so the button opens the video's own full screen there, with the system's controls.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="keyboard">Keyboard and accessibility</PaperText>
            <PaperTextList>
                <li>On the seek line, the Right and Up arrows move 5 seconds forward, Left and Down 5 seconds back, Home goes to the start, and End to the end.</li>
                <li>On the speaker button, the Up and Right arrows raise the volume by 5 percent and Down and Left lower it.</li>
                <li>The root has <PaperCode>role="group"</PaperCode> and the <PaperCode>label</PaperCode> as its name.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="errors">Errors</PaperText>
            <PaperText preset="body" as="p">
                When loading or playback fails, the seek line is replaced by the message and a <PaperCode>Retry</PaperCode> button, in an element with <PaperCode>role="alert"</PaperCode>.
                <PaperCode>onError</PaperCode> receives the same message. The messages are the ones PaperAudio shows, with video in place of audio.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Message</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>Loading stopped</PaperCode></td>
                        <td>The browser aborted the load.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Network error</PaperCode></td>
                        <td>The connection failed while loading.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Can't decode video</PaperCode></td>
                        <td>The browser cannot decode the file.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Can't load video</PaperCode></td>
                        <td>The format is unsupported or the URL is unreachable. Browsers report a 404 this way.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Playback blocked</PaperCode></td>
                        <td>The browser refused <PaperCode>play()</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Video unavailable</PaperCode></td>
                        <td>Any other failure.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="max-height">Limit the height</PaperText>
            <PaperText preset="body" as="p">
                Set <PaperCode>--paper-video-max-height</PaperCode> in a class and pass the class to the player.
                The picture shrinks to fit, and the player stays as wide as the shrunk picture.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperVideo } from "@mileniumhq/paperui";
import styles from "./Clip.module.css";

export function Clip(props: { url: string }) {
    return <PaperVideo class={styles.clip} src={props.url} label="Clip" />;
}`}
            </PaperCode>
            <PaperCode block language="css">
{`/* Clip.module.css */
.clip {
    --paper-video-max-height: 240px;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="poster">Show a poster</PaperText>
            <PaperCode block language="tsx">
{`<PaperVideo src={clip.url} poster={clip.thumbnail} label={clip.title} />`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="report-errors">Report playback errors</PaperText>
            <PaperText preset="body" as="p">
                The player already shows the failure.
                Use <PaperCode>onError</PaperCode> to record it elsewhere.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperVideo } from "@mileniumhq/paperui";

export function Recording(props: { url: string; onFailure: (message: string) => void }) {
    return <PaperVideo src={props.url} label="Recording" onError={props.onFailure} />;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>Sound with no picture is <PaperLink href="/docs/paperui/paperaudio/">PaperAudio</PaperLink>.</li>
                <li>A video, or any other file, shown over the page is <PaperLink href="/docs/paperui/paperpreview/">PaperPreview</PaperLink>, which plays videos with PaperVideo.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
