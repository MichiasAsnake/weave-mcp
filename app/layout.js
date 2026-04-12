import "./globals.css";

export const metadata = {
  title: "Weavy Agent Workbench",
  description: "A Next.js control surface for the Weavy workflow agent prototype.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
