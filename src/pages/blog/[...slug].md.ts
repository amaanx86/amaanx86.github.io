import type { APIContext } from 'astro';
import { postToMarkdown } from '../../lib/post-markdown';
import { getPosts, type Post } from '../../lib/posts';

// Plain Markdown sibling of every published post (/blog/<slug>.md) for agents and LLM tools.
export async function getStaticPaths() {
  return (await getPosts()).map((post) => ({ params: { slug: post.id }, props: { post } }));
}

export async function GET({ props, site }: APIContext<{ post: Post }>) {
  const body = await postToMarkdown(props.post, site ?? new URL('https://amaanx86.github.io'));
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
