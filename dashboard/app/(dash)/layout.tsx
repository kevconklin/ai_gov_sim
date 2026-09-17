import { Nav } from "@/components/nav";

export const dynamic = "force-dynamic";

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="min-w-0 flex-1 p-4">{children}</main>
    </div>
  );
}
