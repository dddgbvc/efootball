import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: {
    default: 'منصة بطولات eFootball',
    template: '%s — منصة بطولات eFootball',
  },
  description:
    'منصة بطولات eFootball: دوريات، تصفيات، توثيق نتائج بالذكاء الاصطناعي، أخبار ومجتمع لاعبين.',
  openGraph: {
    type: 'website',
    locale: 'ar_SA',
    siteName: 'منصة بطولات eFootball',
  },
};

export const viewport: Viewport = {
  themeColor: '#07090c',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/*
          Fonts are linked rather than bundled through next/font so the app
          builds without network access. The no-page-custom-font rule targets
          the pages router's _document, which the App Router does not have —
          this link is in the single root layout, so it loads once for every
          page, which is exactly what the rule asks for.
        */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Archivo:wght@600;700;800;900&display=swap"
        />
      </head>
      <body>
        <a href="#main" className="sr-only">
          تخطَّ إلى المحتوى
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
