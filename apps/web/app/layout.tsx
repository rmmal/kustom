import type { ReactNode } from 'react';

export const metadata = {
  title: 'Customs Night',
  description: 'Team balancer and stats tracker for nightly League customs.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
