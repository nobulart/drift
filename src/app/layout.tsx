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
          className="group fixed bottom-6 right-6 z-[100] flex h-20 w-20 items-center justify-center transition-all hover:scale-[1.04] focus:outline-none focus:ring-2 focus:ring-[#f6d4a4]/50"
          aria-label="Buy me a coffee!"
          title="Buy me a coffee!"
        >
          <span
            aria-hidden="true"
            className="absolute inset-1 rounded-full bg-white/45 shadow-[0_8px_24px_rgba(0,0,0,0.18)] ring-1 ring-white/60 backdrop-blur-sm transition-colors group-hover:bg-white/60"
          />
          <Image
            src={bmcLogo}
            alt=""
            width={42}
            height={62}
            unoptimized
            className="relative z-10 h-[60px] w-auto drop-shadow-md opacity-80 transition-opacity group-hover:opacity-100"
          />
        </a>
      </body>
    </html>
  );
}
