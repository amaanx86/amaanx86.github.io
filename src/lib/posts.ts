import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

export const isPublished = ({ data, id }: Post) => !data.draft && !id.endsWith('.draft.md');

/** Published posts, newest first. */
export async function getPosts(): Promise<Post[]> {
  return (await getCollection('blog', isPublished)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );
}

/**
 * Tags shared by more than one post. These get a /blog/tag/<tag>/ page; a tag on a single post
 * would make a one-item page that only duplicates the post.
 */
export function pageTags(posts: Post[]): Map<string, Post[]> {
  const byTag = new Map<string, Post[]>();
  for (const post of posts) {
    for (const tag of post.data.tags) byTag.set(tag, [...(byTag.get(tag) ?? []), post]);
  }
  return new Map([...byTag].filter(([, list]) => list.length > 1));
}

/** Posts sharing the most tags with `post`, newest first on ties. `posts` must be newest first. */
export function relatedPosts(post: Post, posts: Post[], exclude: string[] = [], limit = 3): Post[] {
  const tags = new Set(post.data.tags);
  return posts
    .filter((p) => p.id !== post.id && !exclude.includes(p.id))
    .map((p) => ({ p, score: p.data.tags.filter((t) => tags.has(t)).length }))
    .filter(({ score }) => score > 0)
    // Array.prototype.sort is stable, so equal scores keep the newest-first input order.
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p }) => p);
}

export const readingTime = (post: Post) => Math.ceil((post.body ?? '').split(/\s+/).length / 200);

export const formatDate = (date: Date) =>
  date.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
