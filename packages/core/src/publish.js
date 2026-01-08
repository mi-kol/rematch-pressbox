import path from 'node:path';
import fs from 'node:fs/promises';
import { simpleGit } from 'simple-git';

export const publishToWorld = async ({ date, slug, title, md, tags = [], author = 'knowball desk' }) => {
    const allTags = Array.from(new Set(["post", ...tags]));
    const tagList = allTags.map(t => `"${t}"`).join(", ");

    const article = `---
title: "${String(title).replaceAll('"', '\\"')}"
date: ${date}
tags: [${tagList}]
author: "${String(author).replaceAll('"', '\\"')}"
layout: base.njk
permalink: /posts/${date}-${slug}
---
${md}\n
`;

    const repoPath = process.env.BLOG_REPO_PATH;
    const postsDir = path.join(repoPath, 'src', 'posts');
    await fs.mkdir(postsDir, { recursive: true });

    const filename = `${date}-${slug}.md`;
    const filepath = path.join(postsDir, filename);

    await fs.writeFile(filepath, article, "utf8");

    const git = simpleGit(repoPath);
    await git.add([filepath]);
    await git.commit(`post: ${slug}`);
    await git.push();

    const base = (process.env.BLOG_BASE_URL || 'https://knowball.netlify.app').replace(/\/$/, '');
    return { filepath, url: `${base}/posts/${date}-${slug}` }
}