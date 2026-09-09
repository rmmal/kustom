import { Archivo, IBM_Plex_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './tokens.css';

/**
 * The two families of `docs/05-design.md`: Archivo for anything read as language, IBM Plex
 * Mono for anything read as data. They are exposed as CSS variables and composed into
 * `--cn-font-sans` / `--cn-font-mono` in `tokens.css`, which is where the fallback stacks live.
 *
 * `display: 'swap'` because the first paint carries content: a friend opening the WhatsApp
 * link should read the teams in the fallback face rather than wait for a webfont.
 */
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--cn-font-archivo',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'swap',
  variable: '--cn-font-plex-mono',
});

export const metadata = {
  title: 'Customs Night',
  description: 'Team balancer and stats tracker for nightly League customs.',
};

/**
 * `viewport-fit` and no user scaling limits: the page is read at arm's length and a friend
 * must be able to zoom it. `themeColor` follows the palette so the phone's browser chrome
 * does not sit as a white bar over a near-black page.
 */
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#12151a' },
    { media: '(prefers-color-scheme: light)', color: '#f3f4f6' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
