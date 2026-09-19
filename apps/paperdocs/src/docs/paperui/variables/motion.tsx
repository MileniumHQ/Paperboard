import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function MotionDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">Motion and effects</PaperText>
            <PaperText preset="body">
                PaperUI defines transition timings, easing bezier curves, and reduced motion overrides.
                Reach for these variables when animating custom state transitions or dialog overlays.
                The motion system honors user accessibility preferences by collapsing animation durations to zero.
            </PaperText>

            <PaperText preset="subheader" id="transition-durations">Transition durations</PaperText>
            <PaperText preset="body">
                Duration tokens provide standard pacing steps:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Standard value</th>
                        <th>Reduced motion value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-tiny-transition</PaperCode></td>
                        <td>0.15s</td>
                        <td>0s</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-short-transition</PaperCode></td>
                        <td>0.2s</td>
                        <td>0s</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-mid-transition</PaperCode></td>
                        <td>0.3s</td>
                        <td>0s</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-medium-transition</PaperCode></td>
                        <td>0.4s</td>
                        <td>0s</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-long-transition</PaperCode></td>
                        <td>0.6s</td>
                        <td>0s</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="easing-curves">Easing curves</PaperText>
            <PaperText preset="body">
                Cubic bezier timing functions:
            </PaperText>

            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Bezier value</th>
                        <th>Application</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-ease-standard</PaperCode></td>
                        <td>cubic-bezier(0.2, 0, 0, 1)</td>
                        <td>General interface state transitions</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-ease-emphasized</PaperCode></td>
                        <td>cubic-bezier(0.16, 1, 0.3, 1)</td>
                        <td>Entering dialogs and emphasis popups</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-ease-symmetric</PaperCode></td>
                        <td>cubic-bezier(0.2, 0, 0.2, 1)</td>
                        <td>Two-way toggles and balance adjustments</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-ease-slide</PaperCode></td>
                        <td>cubic-bezier(0.7, 0, 0.2, 1)</td>
                        <td>Sliding drawer movements</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="reduced-motion-contract">Reduced motion contract</PaperText>
            <PaperText preset="body">
                When the system reports prefers-reduced-motion: reduce or when data-paperui-motion="reduced" is set on the document, all transition variables collapse to 0s.
                All backdrop blur filters are disabled to eliminate motion overhead.
            </PaperText>
        </PaperFlex>
    );
}
