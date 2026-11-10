import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { getStaff } from "@/lib/session";

// Every page in this group calls requireStaff(permission) itself (which also enforces the
// temporary-password rule). The layout only needs a signed-in user, so /account/password can render.
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  return (
    <>
      <Header staff={staff} />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
