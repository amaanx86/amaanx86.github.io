import rss from '@astrojs/rss';
import type { APIContext, ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';
import { getCollection } from 'astro:content';

// Post images live beside the posts and are referenced as ./images/<file>.
const postImages = import.meta.glob<{ default: ImageMetadata }>(
  '/src/content/blog/images/*.{png,jpg,jpeg,webp,gif,svg}',
  { eager: true },
);

const decodeEntities = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The stored HTML carries image placeholders (<img __ASTRO_IMAGE_="{...}">) that only the page
// renderer resolves. Swap each one for the same optimized file the page serves, as an absolute
// URL, because feed readers fetch images from outside the site.
async function resolveImages(html: string, site: URL): Promise<string> {
  const placeholder = /<img __ASTRO_IMAGE_="([^"]*)"\s*\/?>/g;
  const matches = [...html.matchAll(placeholder)];
  let out = html;
  for (const [tag, raw] of matches) {
    const { src, alt = '' } = JSON.parse(decodeEntities(raw)) as { src: string; alt?: string };
    const key = `/src/content/blog/images/${src.replace(/^\.\/images\//, '')}`;
    const meta = postImages[key]?.default;
    if (!meta) {
      // Fail the build rather than ship a feed with a silently missing image.
      throw new Error(`rss.xml: no image found for ${src} (expected ${key})`);
    }
    const img = await getImage({ src: meta });
    const abs = new URL(img.src, site).toString();
    out = out.replace(
      tag,
      `<img src="${abs}" alt="${escapeAttr(alt)}" width="${meta.width}" height="${meta.height}" />`,
    );
  }
  // Root-relative links (e.g. /blog/other-post) also need the site origin outside the browser.
  return out.replace(/(href|src)="\/(?!\/)/g, `$1="${site.origin}/`);
}

export async function GET(context: APIContext) {
  const site = context.site ?? new URL('https://amaanx86.github.io');
  const posts = (await getCollection('blog', ({ data, id }) => !data.draft && !id.endsWith('.draft.md')))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  const items = await Promise.all(
    posts.map(async (post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/blog/${post.id}/`,
      categories: post.data.tags,
      // Full content lets DEV.to and Hashnode import whole posts, not just a summary.
      content: await resolveImages(post.rendered?.html ?? '', site),
    })),
  );

  return rss({
    title: "Amaan's Engineering Notes",
    description:
      'DevOps, cloud security, and platform engineering across AWS, OCI and Azure, by Amaan Ul Haq Siddiqui.',
    site,
    items,
    customData: '<language>en</language>',
  });
}
