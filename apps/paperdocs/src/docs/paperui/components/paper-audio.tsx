import {
    PaperAudio,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const sample = "https://minecraft.wiki/images/Where_are_we_now.ogg";

export default function PaperAudioDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperAudio</PaperText>
            <PaperText preset="body" as="p">
                PaperAudio is a compact audio player that draws the clip's waveform as its seek bar.
                Use it when a panel plays back a recording, a voice message, or a generated clip.
                It brings its own play button, time readout, volume, playback speed, and loop.
                <PaperLink href="/docs/paperui/papervideo/">PaperVideo</PaperLink> shares these controls.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass the audio URL in <PaperCode>src</PaperCode>.
                Set <PaperCode>label</PaperCode> when the page holds more than one player, so each group has its own name for assistive technology.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperAudio src={sample} label="Sample" />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperAudio, PaperCard } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperAudio
                src="https://minecraft.wiki/images/Where_are_we_now.ogg"
                label="Sample"
            />
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperAudioProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> except <PaperCode>onError</PaperCode>, which has a different signature.
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
                        <td>URL of the audio. Changing it resets the player and loads the new clip.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"Audio"</PaperCode></td>
                        <td>Accessible name of the player group.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullWidth</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Fills the container. Without it the player is <PaperCode>--paper-size-card-min</PaperCode> wide, capped at the container's width.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>peaks</PaperCode></td>
                        <td><PaperCode>number[]</PaperCode></td>
                        <td>No default</td>
                        <td>Amplitudes from 0 to 1, drawn instead of fetching and decoding <PaperCode>src</PaperCode>. The player resamples them to the number of bars that fit.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>waveform</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Fetches and decodes <PaperCode>src</PaperCode> to draw its waveform. <PaperCode>false</PaperCode> draws uniform bars and makes no extra request. Ignored when <PaperCode>peaks</PaperCode> is set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>waveformMaxBytes</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>16777216</PaperCode> (16 MiB)</td>
                        <td>Largest source, in bytes, the player downloads to draw a waveform. A source over the cap plays normally and draws uniform bars.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>preload</PaperCode></td>
                        <td><PaperCode>"none" | "metadata" | "auto"</PaperCode></td>
                        <td><PaperCode>"metadata"</PaperCode></td>
                        <td>Forwarded to the audio element. Applies to playback only, not to the waveform download.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onError</PaperCode></td>
                        <td><PaperCode>(message: string) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the message the player shows when loading or playback fails. Not called when only the waveform fails.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid class props</td>
                        <td>No default</td>
                        <td>Added to the root element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="exports">Related exports</PaperText>
            <PaperText preset="body" as="p">
                The package also exports the helpers the player uses.
            </PaperText>
            <PaperCode block language="ts">
{`import {
    computePeaks,
    DEFAULT_WAVEFORM_MAX_BYTES,
    formatAudioTime,
    loadWaveform,
    PAPER_AUDIO_RATES,
} from "@mileniumhq/paperui";

loadWaveform(src: string, signal: AbortSignal, maxBytes?: number): Promise<number[]>;
computePeaks(channels: readonly Float32Array[], resolution?: number): number[];
formatAudioTime(seconds: number): string;
const DEFAULT_WAVEFORM_MAX_BYTES: number;
const PAPER_AUDIO_RATES: readonly [0.5, 0.75, 1, 1.25, 1.5, 2];`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Export</th>
                        <th>Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>loadWaveform</PaperCode></td>
                        <td>Returns peaks from 0 to 1 for the clip. Rejects on an HTTP error, a source over <PaperCode>maxBytes</PaperCode>, missing CORS headers, undecodable audio, no Web Audio, and abort. At most two decodes run at once across the page.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>computePeaks</PaperCode></td>
                        <td>Returns the peak amplitude per bucket across all channels, scaled so the loudest bucket is 1. <PaperCode>resolution</PaperCode> defaults to <PaperCode>WAVEFORM_RESOLUTION</PaperCode> (2048).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>formatAudioTime</PaperCode></td>
                        <td>Returns <PaperCode>m:ss</PaperCode>, or <PaperCode>h:mm:ss</PaperCode> from one hour. Negative and non-finite input gives <PaperCode>0:00</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>DEFAULT_WAVEFORM_MAX_BYTES</PaperCode></td>
                        <td>16 MiB, the default for <PaperCode>waveformMaxBytes</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PAPER_AUDIO_RATES</PaperCode></td>
                        <td>The playback speeds in the options menu.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="waveform">Waveform</PaperText>
            <PaperText preset="body" as="p">
                The player downloads <PaperCode>src</PaperCode> a second time, through <PaperCode>fetch</PaperCode>, to decode it and draw the bars.
                A cross-origin URL needs CORS headers for that request, or the fetch is rejected.
                Until peaks arrive the track shows a flat line.
                When the fetch or decode fails, or the source is over <PaperCode>waveformMaxBytes</PaperCode>, the track draws uniform bars and the clip still plays.
                That failure is silent: the player shows no error and does not call <PaperCode>onError</PaperCode>.
            </PaperText>
            <PaperText preset="body" as="p">
                Wider players draw more bars: the bars and the gaps between them are each <PaperCode>--paper-thick-border-width</PaperCode> wide.
                The filled part of the track follows the playhead.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="controls">Controls</PaperText>
            <PaperTextList>
                <li>The play button toggles play and pause. It is disabled while the player shows an error.</li>
                <li>The time beside the track shows the clip's length until playback starts, then the position.</li>
                <li>The track is a range input named <PaperCode>Seek</PaperCode>. It is disabled until the clip's duration is known.</li>
                <li>The speaker button mutes and unmutes. Hovering or focusing it opens a vertical volume slider.</li>
                <li>The options button opens a menu with <PaperCode>Playback speed</PaperCode> (0.5x, 0.75x, Normal, 1.25x, 1.5x, 2x) and <PaperCode>Loop</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="keyboard">Keyboard and accessibility</PaperText>
            <PaperTextList>
                <li>On the seek track, the Right and Up arrows move 5 seconds forward, Left and Down 5 seconds back, Home goes to the start, and End to the end.</li>
                <li>On the speaker button, the Up and Right arrows raise the volume by 5 percent and Down and Left lower it. Lowering it to 0 mutes. Unmuting from 0 resets the volume to 100 percent.</li>
                <li>The root has <PaperCode>role="group"</PaperCode> and the <PaperCode>label</PaperCode> as its name. The seek input reports its value as, for example, <PaperCode>0:12 of 1:05</PaperCode>.</li>
                <li>The volume slider is outside the tab order, so the speaker button's arrows are its keyboard path. It renders in a portal, so a clipping ancestor cannot cut it off, and it closes on scroll or resize.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="errors">Errors</PaperText>
            <PaperText preset="body" as="p">
                When loading or playback fails, the track is replaced by the message and a <PaperCode>Retry</PaperCode> button, in an element with <PaperCode>role="alert"</PaperCode>.
                <PaperCode>onError</PaperCode> receives the same message. Retry clears the message and reloads the source.
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
                        <td><PaperCode>Can't decode audio</PaperCode></td>
                        <td>The browser cannot decode the file.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Can't load audio</PaperCode></td>
                        <td>The format is unsupported or the URL is unreachable. Browsers report a 404 this way.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Playback blocked</PaperCode></td>
                        <td>The browser refused <PaperCode>play()</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Audio unavailable</PaperCode></td>
                        <td>Any other failure.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="full-width">Fill the container</PaperText>
            <PaperText preset="body" as="p">
                Set <PaperCode>fullWidth</PaperCode> to span a panel's column.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperAudio src={sample} label="Full width" fullWidth />
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperAudio
    src="https://minecraft.wiki/images/Where_are_we_now.ogg"
    label="Full width"
    fullWidth
/>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="stored-peaks">Draw stored peaks</PaperText>
            <PaperText preset="body" as="p">
                Pass <PaperCode>peaks</PaperCode> when a service already stores the waveform, such as a voice-message list that saved peaks at upload.
                The player makes no second request.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperAudio
                    src={sample}
                    label="Stored peaks"
                    peaks={[0.2, 0.35, 0.6, 0.8, 0.55, 0.3, 0.45, 0.9, 1, 0.7]}
                />
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperAudio
    src="https://minecraft.wiki/images/Where_are_we_now.ogg"
    label="Stored peaks"
    peaks={[0.2, 0.35, 0.6, 0.8, 0.55, 0.3, 0.45, 0.9, 1, 0.7]}
/>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="no-waveform">Skip the waveform download</PaperText>
            <PaperText preset="body" as="p">
                Set <PaperCode>waveform={"{false}"}</PaperCode> for a long recording or a host without CORS headers.
                The bars are uniform and playback is unchanged.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperAudio src={sample} label="No waveform" waveform={false} />
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperAudio
    src="https://minecraft.wiki/images/Where_are_we_now.ogg"
    label="No waveform"
    waveform={false}
/>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="report-errors">Report playback errors</PaperText>
            <PaperText preset="body" as="p">
                The player already shows the failure.
                Use <PaperCode>onError</PaperCode> to record it elsewhere, for example in a panel's own log view built with <PaperLink href="/docs/paperui/paperconsole/">PaperConsole</PaperLink>.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperAudio } from "@mileniumhq/paperui";

export function Recording(props: { url: string; onFailure: (message: string) => void }) {
    return <PaperAudio src={props.url} label="Recording" onError={props.onFailure} />;
}`}
            </PaperCode>
        </PaperFlex>
    );
}
