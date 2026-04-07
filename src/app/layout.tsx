import '@/styles/globals.css';
import type { Metadata } from 'next';

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
          className="fixed bottom-4 right-4 z-[100] rounded-full border border-[#5b4630] bg-[#1b1610]/90 px-4 py-2 text-sm font-medium text-[#f6d4a4] shadow-lg backdrop-blur-sm transition-all hover:scale-[1.02] hover:bg-[#2a2118] hover:text-[#ffe8c8]"
          aria-label="Support on Buy Me a Coffee"
        >
          Buy me a coffee
        </a>
      </body>
    </html>
  );
}
