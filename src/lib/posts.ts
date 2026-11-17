import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

export const isPublished = ({ data, id }: Post) => !data.draft && !id.endsWith('.draft.md');

/** Published posts, newest first. */
export async function getPosts(): Promise<Post[]> {
  return (await getCollection('blog', isPublished)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );
}

export const readingTime = (post: Post) => Math.ceil((post.body ?? '').split(/\s+/).length / 200);

export const formatDate = (date: Date) =>
  date.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
