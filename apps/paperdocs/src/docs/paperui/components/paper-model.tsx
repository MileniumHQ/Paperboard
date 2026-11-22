import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperModel,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

// a torus knot, 110 KB, served with the docs
const sample = "/samples/knot.glb";

export default function PaperModelDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperModel</PaperText>
            <PaperText preset="body" as="p">
                PaperModel shows a 3D model that fills its parent: framed at a three-quarter angle, lit as in a studio, on a soft contact shadow.
                Use it when a panel shows a model file: a part to print, an asset, or a file the user picked.
                The model turns with a drag, zooms with the wheel or a pinch, and moves with a right-drag or two fingers.{" "}
                <PaperLink href="/docs/paperui/paperpreview/">PaperPreview</PaperLink> shows 3D files with it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass the model's URL in <PaperCode>src</PaperCode>, and give the viewer a parent with a height.
                It fills that parent, and with no height from it, it keeps the <PaperCode>panel-height-small</PaperCode> size.
                The format comes from the file's extension; for a <PaperCode>blob:</PaperCode> URL, pass <PaperCode>format</PaperCode> or <PaperCode>name</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex height="panel-height-large" fullWidth>
                    <PaperModel src={sample} label="Torus knot" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperModel } from "@mileniumhq/paperui";

export function Example(props: { url: string }) {
    return (
        <PaperFlex height="panel-height-large" fullWidth>
            <PaperModel src={props.url} label="Torus knot" />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperModelProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> except <PaperCode>onError</PaperCode>, which has a different signature.
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
                        <td>URL of the model. <PaperCode>blob:</PaperCode> and <PaperCode>data:</PaperCode> URLs work. Changing it replaces the model.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>format</PaperCode></td>
                        <td><PaperCode>PaperModelFormat</PaperCode></td>
                        <td>From <PaperCode>name</PaperCode>, then <PaperCode>src</PaperCode></td>
                        <td>The file's format: <PaperCode>"glb"</PaperCode>, <PaperCode>"gltf"</PaperCode>, <PaperCode>"obj"</PaperCode>, <PaperCode>"stl"</PaperCode>, <PaperCode>"ply"</PaperCode>, <PaperCode>"fbx"</PaperCode>, <PaperCode>"3mf"</PaperCode>, <PaperCode>"dae"</PaperCode> or <PaperCode>"usdz"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>name</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The file's name. Its extension gives the format when <PaperCode>format</PaperCode> isn't set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>name</PaperCode>, then <PaperCode>"3D model"</PaperCode></td>
                        <td>Accessible name of the viewer and of the picture in it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>controls</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Shows the buttons over the bottom edge: <PaperCode>Reset view</PaperCode>, and <PaperCode>Play</PaperCode> or <PaperCode>Pause</PaperCode> for an animated model.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>autoRotate</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Turns the model slowly while nobody is moving it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onError</PaperCode></td>
                        <td><PaperCode>(message: string) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the message the viewer shows when the model can't be shown.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid class props</td>
                        <td>No default</td>
                        <td>Added to the root element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="formats">Formats</PaperText>
            <PaperTextList>
                <li>glTF and GLB, with Draco and Meshopt geometry and KTX2 textures. The decoders are separate files, loaded only for a model that needs them.</li>
                <li>OBJ with its MTL material file, STL, PLY, FBX, 3MF, Collada (DAE) and USDZ.</li>
                <li>A model without materials, such as an STL, gets a soft gray. Vertex colors are kept.</li>
                <li>STL and 3MF files are usually modeled with Z up. They are turned so Z points up on screen.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="view">View</PaperText>
            <PaperTextList>
                <li>The model is fitted to the view whatever its size and wherever it sits in its file, and seen from a little above and to the side.</li>
                <li>When a model appears, it turns a quarter turn and grows into place. With reduced motion, it appears at once.</li>
                <li>Double-clicking the model, or pressing <PaperCode>Reset view</PaperCode>, glides the camera back to where it started.</li>
                <li>A model with animations plays its first one in a loop. <PaperCode>Pause</PaperCode> stops it where it is.</li>
                <li>The background is transparent, so the model sits on the surface around the viewer in both themes.</li>
                <li>Where a pointer can hover, the buttons fade in when it is over the viewer.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="performance">Performance</PaperText>
            <PaperTextList>
                <li>The viewer and three.js load the first time a model is shown. Pages without one never download them.</li>
                <li>A frame is drawn only when something moves: the entrance, a drag settling, auto-rotation or an animation. A model at rest costs nothing.</li>
                <li>Each viewer has one WebGL context and gives it back as soon as it unmounts. Browsers allow only about 16 at once, so opening and closing many viewers never runs out.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="security">Files it refers to</PaperText>
            <PaperText preset="body" as="p">
                A model can refer to other files: a glTF to its textures and buffers, an OBJ to its materials, an FBX to its textures.
                PaperModel loads them only from the model itself (<PaperCode>data:</PaperCode> and <PaperCode>blob:</PaperCode> URLs) and from the model's own origin.
                Anything else is never requested. A texture from elsewhere is left off and the model shows without it. Geometry from elsewhere fails the model.
                Nothing in a file is ever run.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="errors">Errors</PaperText>
            <PaperText preset="body" as="p">
                When the model can't be shown, the viewer shows the message in an element with <PaperCode>role="alert"</PaperCode>, with <PaperCode>Retry</PaperCode> when trying again can help.{" "}
                <PaperCode>onError</PaperCode> receives the same message.
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
                        <td><PaperCode>Can't load the model</PaperCode></td>
                        <td>The request failed. Has Retry.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>The model isn't there anymore</PaperCode></td>
                        <td>The server answered 404 or 410. Has Retry.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Can't read this 3D model</PaperCode></td>
                        <td>The file is damaged, or isn't in the format it claims.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>This 3D model has nothing to show</PaperCode></td>
                        <td>The file holds no geometry.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>This model keeps its data on another site, which isn't loaded</PaperCode></td>
                        <td>The geometry is in a file on another origin.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>This model is compressed in a way this page can't decode</PaperCode></td>
                        <td>Meshopt geometry on a page whose content security policy refuses WebAssembly.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Can't tell which kind of 3D file this is</PaperCode></td>
                        <td>No <PaperCode>format</PaperCode>, and no known extension on <PaperCode>name</PaperCode> or <PaperCode>src</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Can't load the 3D viewer</PaperCode></td>
                        <td>The viewer's code didn't download. Has Retry.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>3D isn't available in this browser</PaperCode></td>
                        <td>The browser can't create a WebGL context.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>The 3D view stopped</PaperCode></td>
                        <td>The WebGL context was lost, for example when the graphics driver restarted. Has Retry.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="thumbnails">Thumbnails</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>renderModelThumbnail(src, format, size, signal?)</PaperCode> draws a model as a square PNG, <PaperCode>size</PaperCode> pixels on a side, framed and lit as PaperModel shows it, on a transparent background.
                Every thumbnail is drawn by one shared renderer, one at a time, so a folder of models costs one WebGL context. The renderer is freed after a while without requests.
                It rejects with the message PaperModel would show, or with the signal's reason once it aborts.
            </PaperText>
            <PaperCode block language="tsx">
{`import { renderModelThumbnail } from "@mileniumhq/paperui";

const controller = new AbortController();
const png = await renderModelThumbnail(file.url, "glb", 256, controller.signal);
image.src = URL.createObjectURL(png);`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="blob">Show a file the user picked</PaperText>
            <PaperText preset="body" as="p">
                A <PaperCode>blob:</PaperCode> URL has no extension, so pass the file's name.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperModel src={URL.createObjectURL(file)} name={file.name} />`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="showcase">Turn on its own</PaperText>
            <PaperCode block language="tsx">
{`<PaperModel src={part.url} label={part.name} autoRotate controls={false} />`}
            </PaperCode>
        </PaperFlex>
    );
}
