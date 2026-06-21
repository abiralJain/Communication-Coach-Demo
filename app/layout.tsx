import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Communication Coach",
  description: "Private speaking practice with a voice coach.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
