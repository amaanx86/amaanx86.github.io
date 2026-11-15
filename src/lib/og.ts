import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import satori from 'satori';
import sharp from 'sharp';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// Light-mode tokens from global.css, resolved to hex: satori's colour parser is not a browser
// and the card has no theme toggle, so it always renders on paper.
const c = {
  canvas: '#fcfaf6',
  surface: '#f7f5f1',
  border: '#e2dfda',
  text: '#221f1c',
  muted: '#5f5954',
  faint: '#746e67',
  accent: '#223ece',
};

// Satori cannot read woff2 or variable fonts, so the card uses the static Fontsource builds of
// the same three families. Resolved from the project root because the packages' export maps
// only expose CSS, and the build always runs from there.
const fontFile = (pkg: string, file: string) =>
  readFile(join(process.cwd(), 'node_modules/@fontsource', pkg, 'files', file));

let fontsPromise: ReturnType<typeof loadFonts> | undefined;

async function loadFonts() {
  const [serif, sans, sansBold, mono] = await Promise.all([
    fontFile('source-serif-4', 'source-serif-4-latin-600-normal.woff'),
    fontFile('inter', 'inter-latin-400-normal.woff'),
    fontFile('inter', 'inter-latin-600-normal.woff'),
    fontFile('jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff'),
  ]);
  return [
    { name: 'Source Serif 4', data: serif, weight: 600 as const, style: 'normal' as const },
    { name: 'Inter', data: sans, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: sansBold, weight: 600 as const, style: 'normal' as const },
    { name: 'JetBrains Mono', data: mono, weight: 400 as const, style: 'normal' as const },
  ];
}

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
// Satori treats width/height as content-box and sizes flex children from their unwrapped text,
// so the root and every section get explicit content dimensions to keep the card inside 1200x630.
const PAD_TOP = 64;
const PAD_BOTTOM = 56;
const PAD_LEFT = 72;
const PAD_RIGHT = 80;
const STRIPE = 10;
const CONTENT_WIDTH = OG_WIDTH - STRIPE - PAD_LEFT - PAD_RIGHT;
const CONTENT_HEIGHT = OG_HEIGHT - PAD_TOP - PAD_BOTTOM;

const h = (style: Record<string, unknown>, children?: unknown): Node => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children },
});

// Long titles step down so they hold three lines at most without clipping mid-word.
function titleSize(title: string): number {
  if (title.length > 90) return 50;
  if (title.length > 60) return 58;
  return 68;
}

const mono = { fontFamily: 'JetBrains Mono', fontSize: 22, color: c.faint };

const chip = (label: string) =>
  h(
    {
      ...mono,
      fontSize: 20,
      color: c.muted,
      backgroundColor: c.surface,
      border: `1px solid ${c.border}`,
      borderRadius: 4,
      padding: '6px 12px',
    },
    label,
  );

const chips = (labels: string[]) => h({ gap: 10 }, labels.map(chip));

// Every card shares one frame: a mono header line, the body, and a hairline-ruled footer, all on
// paper with the accent stripe. Only the slot contents differ between post and site cards.
async function renderCard(slots: {
  headLeft: string;
  headRight: string;
  body: Node[];
  footLeft: Node;
  footRight: Node;
}): Promise<Buffer> {
  fontsPromise ??= loadFonts();
  const fonts = await fontsPromise;

  const tree = h(
    {
      width: CONTENT_WIDTH,
      height: CONTENT_HEIGHT,
      backgroundColor: c.canvas,
      borderLeft: `${STRIPE}px solid ${c.accent}`,
      padding: `${PAD_TOP}px ${PAD_RIGHT}px ${PAD_BOTTOM}px ${PAD_LEFT}px`,
      flexDirection: 'column',
      justifyContent: 'space-between',
    },
    [
      h({ width: CONTENT_WIDTH, justifyContent: 'space-between', ...mono }, [
        h({}, slots.headLeft),
        h({}, slots.headRight),
      ]),
      h({ width: CONTENT_WIDTH, flexDirection: 'column', gap: 24 }, slots.body),
      h(
        {
          width: CONTENT_WIDTH,
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: `1px solid ${c.border}`,
          paddingTop: 28,
        },
        [slots.footLeft, slots.footRight],
      ),
    ],
  );

  const svg = await satori(tree as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts,
  });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

const serifTitle = (text: string, fontSize: number) =>
  h(
    {
      display: 'block',
      fontFamily: 'Source Serif 4',
      fontWeight: 600,
      fontSize,
      lineHeight: 1.12,
      letterSpacing: '-0.01em',
      color: c.text,
      lineClamp: 3,
    },
    text,
  );

const lede = (text: string) =>
  h(
    {
      display: 'block',
      fontFamily: 'Inter',
      fontSize: 26,
      lineHeight: 1.45,
      color: c.muted,
      lineClamp: 2,
    },
    text,
  );

const NAME = 'Amaan Ul Haq Siddiqui';
const ROLE = 'DevOps & Cloud Security Engineer';

export interface OgPost {
  title: string;
  description: string;
  date: Date;
  tags: string[];
}

export function renderPostOg(post: OgPost): Promise<Buffer> {
  const date = post.date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return renderCard({
    headLeft: 'amaanx86.github.io/blog',
    headRight: date,
    body: [serifTitle(post.title, titleSize(post.title)), lede(post.description)],
    footLeft: h({ flexDirection: 'column', gap: 4 }, [
      h({ fontFamily: 'Inter', fontWeight: 600, fontSize: 26, color: c.text }, NAME),
      h({ ...mono, fontSize: 20 }, ROLE),
    ]),
    footRight: chips(post.tags.slice(0, 3)),
  });
}

// Fallback card for every page that is not a post: home, projects, the blog index, verify.
export function renderSiteOg(): Promise<Buffer> {
  return renderCard({
    headLeft: 'amaanx86.github.io',
    headRight: "Amaan's Engineering Notes",
    body: [
      h({ flexDirection: 'column', gap: 14 }, [
        serifTitle(NAME, 76),
        h({ fontFamily: 'Inter', fontWeight: 600, fontSize: 30, color: c.accent }, ROLE),
      ]),
      lede(
        'Building infrastructure at scale across AWS, OCI, and Azure. Observability, ' +
          'platform security, and open source tooling that fills real gaps.',
      ),
    ],
    footLeft: h({ ...mono, fontSize: 20 }, 'writing / projects / upstream contributions'),
    footRight: chips(['aws', 'oci', 'azure', 'kubernetes']),
  });
}
