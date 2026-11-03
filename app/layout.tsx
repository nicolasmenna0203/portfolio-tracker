import type { Metadata, Viewport } from 'next';
import { Public_Sans, Spectral } from 'next/font/google';
import './globals.css';

const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const spectral = Spectral({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Portfolio · Dashboard',
  description: 'Dashboard personal de inversiones',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Portfolio',
  },
};

// Sin viewport la página se renderiza a ancho de escritorio y el navegador la
// escala: todo queda diminuto en el celular. `viewportFit: cover` + los safe-area
// insets del CSS permiten usar la pantalla completa en iPhone con notch.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)',  color: '#211d17' },
    { media: '(prefers-color-scheme: light)', color: '#f7f4ec' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${publicSans.variable} ${spectral.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
