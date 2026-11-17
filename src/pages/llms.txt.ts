import type { APIContext } from 'astro';
import { postMarkdownUrl } from '../lib/post-markdown';
import { getPosts } from '../lib/posts';

// Index for LLM tools, following the llms.txt proposal (https://llmstxt.org): an H1, a
// blockquote summary, then sections of links. Posts link to their Markdown copies.
export async function GET({ site }: APIContext) {
  const origin = site ?? new URL('https://amaanx86.github.io');
  const posts = await getPosts();

  const postLines = posts.map(
    (p) =>
      `- [${p.data.title}](${postMarkdownUrl(p.id, origin)}): ${p.data.description} ` +
      `(${p.data.date.toISOString().slice(0, 10)})`,
  );

  const page = (path: string) => new URL(path, origin).toString();

  const body = [
    "# Amaan's Engineering Notes",
    '',
    '> DevOps, cloud security, and platform engineering across AWS, OCI and Azure, by Amaan Ul ' +
      'Haq Siddiqui. Posts are written from production work: observability, IaC, migrations, ' +
      'identity, and supply chain security.',
    '',
    'Every post is available as plain Markdown by appending `.md` to its slug, for example ' +
      `${postMarkdownUrl(posts[0]?.id ?? 'example', origin)}. The HTML page at ` +
      '`/blog/<slug>/` is the canonical copy.',
    '',
    '## Posts',
    '',
    ...postLines,
    '',
    '## About',
    '',
    `- [Contributions](${page('/projects')}): upstream open-source work and community`,
    `- [Verify](${page('/verify')}): GPG keys and verified accounts`,
    '',
    '## Optional',
    '',
    `- [RSS feed](${page('/rss.xml')}): full-content feed of every post`,
    '',
  ].join('\n');

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
