import type { APIRoute } from 'astro';
import { renderSiteOg } from '../lib/og';

// Served at the same path the old static file used, so Base.astro's default needs no change.
export const GET: APIRoute = async () => {
  const png = await renderSiteOg();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
