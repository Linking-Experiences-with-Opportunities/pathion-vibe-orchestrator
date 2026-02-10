import type { Metadata } from "next";
import AuthenticatedLayout from '@/components/auth/AuthenticatedLayout';
import ClientLayout from '@/components/SupabaseAuth/ClientLayout';
import { ThemeProvider } from "@/lib/ThemeContext";
import { SidebarProvider } from "@/contexts/sidebar-context";
import { ModuleSidebarProvider } from "@/contexts/module-sidebar-context";
import { ModuleNavigationProvider } from "@/contexts/module-navigation-context";
import { NavbarVisibilityProvider } from "@/contexts/navbar-visibility-context";
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from "@vercel/speed-insights/next";
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration';
import RunnerDevPanel from '@/components/RunnerDevPanel';
import ReportCardDebug from '@/components/ReportCardDebug';
import { FeedbackWidget } from '@/components/FeedbackWidget';
import { Inter } from 'next/font/google';
import './globals.css'

const inter = Inter({ subsets: ['latin'] });

const APP_NAME = "Learn with Leo";
const APP_DEFAULT_TITLE = "Learn with Leo";
const APP_TITLE_TEMPLATE = "%s - Learn with Leo";
const APP_DESCRIPTION = "Practice real data structures in the browser.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://learnwithleo.com"),
  applicationName: APP_NAME,
  title: {
    default: APP_DEFAULT_TITLE,
    template: APP_TITLE_TEMPLATE,
  },
  description: APP_DESCRIPTION,
  themeColor: "#000000",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_DEFAULT_TITLE,
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    url: "https://learnwithleo.com",
    title: {
      default: APP_DEFAULT_TITLE,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
    images: [
      {
        url: "https://learnwithleo.com/images/og.jpeg",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: {
      default: APP_DEFAULT_TITLE,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
    images: ["/images/og.jpeg"],
  },
};


export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body className={inter.className}>
        <ServiceWorkerRegistration />
        <RunnerDevPanel />
        <ThemeProvider>
          <SidebarProvider>
            <ModuleSidebarProvider>
              <ModuleNavigationProvider>
                <NavbarVisibilityProvider>
                  <ClientLayout>
                    <AuthenticatedLayout>
                      <div className="flex h-screen">
                        <main className="flex-1 overflow-auto">
                          {children}
                        </main>
                      </div>
                    </AuthenticatedLayout>
                    <FeedbackWidget />
                  </ClientLayout>
                </NavbarVisibilityProvider>
              </ModuleNavigationProvider>
            </ModuleSidebarProvider>
          </SidebarProvider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
        <ReportCardDebug />
      </body>
    </html>
  );
}
