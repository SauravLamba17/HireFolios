import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { roleEnum, users } from "@/db/schema";
import { formatDateIST } from "@/lib/ist";
import { requireStaff, ROLE_LABELS } from "@/lib/session";
import { UsersManager } from "./users-manager";

export const metadata: Metadata = { title: "Staff" };

export default async function UsersPage() {
  const staff = await requireStaff("users");
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.tenantId, staff.tenantId))
    .orderBy(asc(users.createdAt));

  return (
    <UsersManager
      currentUserId={staff.id}
      roles={roleEnum.enumValues.map((value) => ({ value, label: ROLE_LABELS[value] }))}
      users={rows.map(({ createdAt, ...r }) => ({ ...r, added: formatDateIST(createdAt) }))}
    />
  );
}
