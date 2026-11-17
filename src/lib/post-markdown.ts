import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';
import type { CollectionEntry } from 'astro:content';

// Post images live beside the posts and are referenced as ./images/<file>.
const postImages = import.meta.glob<{ default: ImageMetadata }>(
  '/src/content/blog/images/*.{png,jpg,jpeg,webp,gif,svg}',
  { eager: true },
);

const FENCE = /^(\s*)(`{3,}|~{3,})/;

// Agents fetch the .md from outside the site, so relative image paths and root-relative links
// must become absolute. Fenced code is left untouched: a snippet that happens to contain
// "./images/" or "](/" is content, not a reference.
async function absolutize(body: string, site: URL): Promise<string> {
  const lines = body.split('\n');
  let fence: string | null = null;
  const out: string[] = [];

  for (const line of lines) {
    const m = line.match(FENCE);
    if (m) {
      if (fence === null) fence = m[2][0];
      else if (m[2][0] === fence) fence = null;
      out.push(line);
      continue;
    }
    if (fence !== null) {
      out.push(line);
      continue;
    }

    let next = line;
    for (const [whole, src] of [...line.matchAll(/\]\((\.\/images\/[^)\s]+)\)/g)]) {
      const key = `/src/content/blog/images/${src.replace(/^\.\/images\//, '')}`;
      const meta = postImages[key]?.default;
      if (!meta) {
        // Fail the build rather than publish a .md with a silently broken image.
        throw new Error(`post markdown: no image found for ${src} (expected ${key})`);
      }
      // Same optimized file the HTML page serves.
      const img = await getImage({ src: meta });
      next = next.replace(whole, `](${new URL(img.src, site).toString()})`);
    }
    out.push(next.replace(/\]\(\/(?!\/)/g, `](${site.origin}/`));
  }
  return out.join('\n');
}

export const postUrl = (id: string, site: URL) => new URL(`/blog/${id}/`, site).toString();
export const postMarkdownUrl = (id: string, site: URL) => new URL(`/blog/${id}.md`, site).toString();

// JSON strings are valid YAML double-quoted scalars, so this escapes titles safely.
const yamlString = (s: string) => JSON.stringify(s);

export async function postToMarkdown(post: CollectionEntry<'blog'>, site: URL): Promise<string> {
  const { title, description, date, updated, tags } = post.data;
  const frontmatter = [
    '---',
    `title: ${yamlString(title)}`,
    `description: ${yamlString(description)}`,
    `date: ${date.toISOString().slice(0, 10)}`,
    ...(updated ? [`updated: ${updated.toISOString().slice(0, 10)}`] : []),
    `tags: [${tags.map(yamlString).join(', ')}]`,
    'author: "Amaan Ul Haq Siddiqui"',
    // The HTML page is the canonical copy; this file is a plain-text rendition of it.
    `canonical: ${yamlString(postUrl(post.id, site))}`,
    '---',
  ].join('\n');

  const body = await absolutize((post.body ?? '').trim(), site);
  return `${frontmatter}\n\n# ${title}\n\n${body}\n`;
}
