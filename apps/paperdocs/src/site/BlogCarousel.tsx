import { PaperText } from "@paperboard-dev/paperui";
import { For } from "solid-js";
import type { Slide } from "./blogBlocks";
import styles from "./site.module.css";

// Static markup for a post carousel: the first slide shows and the rest are
// inert until src/site/blogCarousel.ts wires up the dots and autoplay in the
// browser. The data-carousel-* attributes are that script's hooks, since the
// CSS module class names are hashed.
export function BlogCarousel(props: { slides: Slide[] }) {
    return (
        <section
            class={styles.carousel}
            data-carousel
            aria-roledescription="carousel"
            aria-label="Image carousel"
        >
            <div class={styles.carouselFrame}>
                <div class={styles.carouselTrack} data-carousel-track>
                    <For each={props.slides}>
                        {(slide, index) => (
                            <figure
                                class={styles.carouselSlide}
                                data-carousel-slide
                                role="group"
                                aria-roledescription="slide"
                                aria-label={`${index() + 1} of ${props.slides.length}`}
                                aria-hidden={index() === 0 ? undefined : "true"}
                                inert={index() !== 0}
                            >
                                <img src={slide.src} alt={slide.alt} />
                                <PaperText
                                    preset="caption"
                                    color="text-subtle"
                                    as="figcaption"
                                >
                                    {slide.caption}
                                </PaperText>
                            </figure>
                        )}
                    </For>
                </div>
            </div>
            <div class={styles.carouselDots}>
                <For each={props.slides}>
                    {(_, index) => (
                        <button
                            type="button"
                            class={styles.carouselDot}
                            data-carousel-dot
                            aria-label={`Show slide ${index() + 1}`}
                            aria-current={index() === 0 ? "true" : undefined}
                        >
                            <span
                                class={styles.carouselProgress}
                                data-carousel-progress
                            />
                        </button>
                    )}
                </For>
            </div>
        </section>
    );
}
