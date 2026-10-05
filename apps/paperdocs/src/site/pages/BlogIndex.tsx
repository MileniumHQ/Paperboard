import {
    PaperIcon,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperPageHeader,
    PaperText,
} from "@mileniumhq/paperui";
import { For } from "solid-js";
import { BLOG_POSTS } from "../blog";

const BANNER_HEIGHT = "170px";

export function BlogIndex() {
    return (
        <>
            <PaperPageHeader
                icon="newspaper"
                title="Blog"
                subtitle="The official newsroom for Paperboard."
            />
            <PaperMediaCardGroup minCardWidth="300px">
                <For each={BLOG_POSTS}>
                    {(post) => (
                        <PaperMediaCard
                            banner={post.image}
                            bannerHeight={BANNER_HEIGHT}
                            title={post.title}
                            subtitle={post.date}
                            description={post.summary}
                            footerLeft={
                                <PaperText
                                    size={1}
                                    weight={700}
                                    color="text-subtle"
                                >
                                    Read post
                                </PaperText>
                            }
                            footerRight={
                                <PaperIcon zeroHeight>arrow_forward</PaperIcon>
                            }
                            href={`/blog/${post.slug}/`}
                        />
                    )}
                </For>
            </PaperMediaCardGroup>
        </>
    );
}
