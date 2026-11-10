import { Header } from "@/components/header";
import { requireStaff } from "@/lib/session";

// Every page in this group also calls requireStaff(permission) itself.
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  return (
    <>
      <Header staff={staff} />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
