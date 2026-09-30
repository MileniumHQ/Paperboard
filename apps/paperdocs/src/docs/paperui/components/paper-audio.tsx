import {
    PaperAudio,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

const sample = "https://minecraft.wiki/images/Where_are_we_now.ogg";

export default function PaperAudioDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperAudio</PaperText>
            <PaperText preset="body">
                PaperAudio is a compact audio player with the clip's waveform as its seek bar.
                Reach for PaperAudio when a panel plays back a recording, a voice message, or a generated clip.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass the audio URL in <PaperCode>src</PaperCode>.
                Set <PaperCode>label</PaperCode> to name the player for assistive technology.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperAudio, PaperCard } from "@paperboard-dev/paperui";

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

            <PaperCard padding="double" surface="front">
                <PaperAudio src={sample} label="Sample" />
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperAudio accepts the following props. Other props pass through to the root element.
            </PaperText>
            <PaperTable>
                    <thead>
                        <tr>
                            <th>Prop</th>
                            <th>Type</th>
                            <th>Default</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><PaperCode>src</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td>No default</td>
                            <td>Audio URL.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>label</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>"Audio"</PaperCode></td>
                            <td>Accessible name of the player.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>fullWidth</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Fills the container instead of <PaperCode>--paper-size-card-min</PaperCode>.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>waveform</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>true</PaperCode></td>
                            <td>Downloads and decodes <PaperCode>src</PaperCode> to draw its waveform. <PaperCode>false</PaperCode> draws uniform bars.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>waveformMaxBytes</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>16777216</PaperCode> (16 MiB)</td>
                            <td>Largest source downloaded for the waveform.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>peaks</PaperCode></td>
                            <td><PaperCode>number[]</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Precomputed amplitudes from 0 to 1, drawn instead of decoding <PaperCode>src</PaperCode>.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>preload</PaperCode></td>
                            <td><PaperCode>"none" | "metadata" | "auto"</PaperCode></td>
                            <td><PaperCode>"metadata"</PaperCode></td>
                            <td>Forwarded to the audio element.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>onError</PaperCode></td>
                            <td><PaperCode>(message: string) =&gt; void</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Called with the message shown when loading or playback fails.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Drawing the waveform downloads the source a second time, so a cross-origin URL needs CORS headers.
                When that download fails or exceeds <PaperCode>waveformMaxBytes</PaperCode>, the player draws uniform bars and still plays.
                The seek bar, volume, and options menu all work from the keyboard.
                When playback fails, the player shows the error with a <PaperCode>Retry</PaperCode> button.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Set <PaperCode>fullWidth</PaperCode> to span the container. Wider players draw more bars.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperAudio
    src="https://minecraft.wiki/images/Where_are_we_now.ogg"
    label="Full width"
    fullWidth
/>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperAudio src={sample} label="Full width" fullWidth />
            </PaperCard>
            <PaperText preset="body">
                Pass <PaperCode>peaks</PaperCode> when a service already stores the waveform.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperAudio
    src="https://minecraft.wiki/images/Where_are_we_now.ogg"
    label="Stored peaks"
    peaks={[0.2, 0.35, 0.6, 0.8, 0.55, 0.3, 0.45, 0.9, 1, 0.7]}
/>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperAudio
                    src={sample}
                    label="Stored peaks"
                    peaks={[0.2, 0.35, 0.6, 0.8, 0.55, 0.3, 0.45, 0.9, 1, 0.7]}
                />
            </PaperCard>
        </PaperFlex>
    );
}
