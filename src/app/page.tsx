import { redirect } from "next/navigation";
import { homePath, requireStaff } from "@/lib/session";

export default async function Home() {
  const staff = await requireStaff();
  redirect(homePath(staff.role));
}
