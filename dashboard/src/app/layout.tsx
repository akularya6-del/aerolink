import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "API Key Manager Dashboard",
  description: "Real-time dashboard for Aerolink API Key Manager",
};

import { ThemeProvider } from "@/components/ThemeProvider";
import { CommandPalette } from "@/components/CommandPalette";
import SplineBackground from "@/components/SplineBackground";
import RobotCompanion from "@/components/RobotCompanion";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-background text-foreground flex h-screen overflow-hidden`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <SplineBackground />
          <CommandPalette />
          <Sidebar />
          <RobotCompanion />
          <main className="flex-1 overflow-y-auto bg-muted/20 relative z-10">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
