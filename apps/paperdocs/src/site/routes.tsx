import type { Component } from "solid-js";
import { BlogIndex } from "./pages/BlogIndex";
import { BlogPost } from "./pages/BlogPost";
import { Contact } from "./pages/Contact";
import { Downloads } from "./pages/Downloads";
import { BLOG_POSTS } from "./blog";

export interface SiteRoute {
    path: string;
    title: string;
    description: string;
    component: Component;
}

// Every PaperUI root page that the site build prerenders. The landing ("/")
// is not here: it renders its own document chrome through a Solid component
// (src/site/landing/Landing.tsx) instead of SitePage, so entry-server handles
// it as its own kind.
export const SITE_ROUTES: SiteRoute[] = [
    {
        path: "/blog/",
        title: "Blog | Paperboard",
        description: "The official newsroom for Paperboard.",
        component: BlogIndex,
    },
    ...BLOG_POSTS.map(
        (post): SiteRoute => ({
            path: `/blog/${post.slug}/`,
            title: `${post.title} | Paperboard Blog`,
            description: post.summary,
            component: () => <BlogPost post={post} />,
        }),
    ),
    {
        path: "/downloads/",
        title: "Downloads | Paperboard",
        description:
            "Download Paperboard for Windows, macOS, and Linux. Pre-release alpha builds.",
        component: Downloads,
    },
    {
        path: "/contact/",
        title: "Contact | Paperboard",
        description:
            "Contact the Paperboard team about privacy requests, panels, security, or anything else.",
        component: Contact,
    },
];
