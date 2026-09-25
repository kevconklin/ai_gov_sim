import { currentOperator } from "@/lib/auth/session";
import { Nav } from "@/components/nav";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const operator = await currentOperator();
  return (
    <div className="dash">
      <Nav operator={operator} />
      <main className="dash-main">{children}</main>
    </div>
  );
}
