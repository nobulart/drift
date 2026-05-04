import '@/styles/globals.css';
import type { Metadata } from 'next';
import Image from 'next/image';
import bmcLogo from '../../docs/assets/bmc-logo.svg';

export const metadata: Metadata = {
  title: 'DRIFT Dashboard',
  description: 'Geodetic-Geomagnetic Coupling Dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <a
          href="https://buymeacoffee.com/nobulart"
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-6 right-6 z-[100] opacity-70 transition-all hover:scale-[1.04] hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#f6d4a4]/50"
          aria-label="Buy me a coffee!"
          title="Buy me a coffee!"
        >
          <Image
            src={bmcLogo}
            alt=""
            width={42}
            height={62}
            unoptimized
            className="h-[60px] w-auto drop-shadow-md"
          />
        </a>
      </body>
    </html>
  );
}
