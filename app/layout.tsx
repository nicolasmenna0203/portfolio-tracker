import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// Tipografía: SF Pro en dispositivos Apple (`-apple-system` en la pila de
// globals.css) e Inter como reemplazo en Windows y Android, donde SF no existe y
// no se puede servir. Inter va como variable, no como clase: la pila decide.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
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
    { media: '(prefers-color-scheme: dark)',  color: '#000000' },
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
  ],
};

// El tema sigue al del sistema salvo que se haya elegido otro a mano (ver
// Dashboard). Se aplica antes del primer pintado: si esperara a la hidratación,
// quien eligió el tema contrario al del sistema vería un destello del otro.
const SCRIPT_TEMA = `try{var t=localStorage.getItem('tema_v1');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
