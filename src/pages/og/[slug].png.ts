import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { renderPostOg } from '../../lib/og';

export const getStaticPaths = (async () => {
  const posts = await getCollection('blog', ({ data, id }) => !data.draft && !id.endsWith('.draft.md'));
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { data } = (props as { post: CollectionEntry<'blog'> }).post;
  const png = await renderPostOg(data);
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
