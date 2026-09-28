import { PaperMarkdown, PaperText } from "@paperboard-dev/paperui";
import { Show } from "solid-js";
import type { Post } from "../blog";
import styles from "../site.module.css";

export function BlogPost(props: { post: Post }) {
    return (
        <>
            <header class={styles.postHeader}>
                <PaperText rounded preset="header" as="h1">
                    {props.post.title}
                </PaperText>
                <div class={styles.postInfo}>
                    <PaperText preset="caption" color="text-subtle">
                        {props.post.date}
                    </PaperText>
                    <Show when={props.post.author}>
                        <span
                            class={styles.postInfoSeparator}
                            aria-hidden="true"
                        >
                            ·
                        </span>
                        <PaperText preset="caption" color="text-subtle">
                            {props.post.author}
                        </PaperText>
                    </Show>
                    <span class={styles.postInfoSeparator} aria-hidden="true">
                        ·
                    </span>
                    <PaperText preset="caption" color="text-subtle">
                        {props.post.readingMinutes} min read
                    </PaperText>
                </div>
            </header>
            <img class={styles.postBanner} src={props.post.image} alt="" />
            <div class={styles.postBody}>
                <PaperMarkdown text={props.post.body} />
            </div>
        </>
    );
}
