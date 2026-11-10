"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Row = { id: string; name: string; email: string; role: string; active: boolean; added: string };
type Option = { value: string; label: string };

async function send(url: string, method: "POST" | "PATCH", body: unknown) {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    if (res.status === 401) return "Your session ended. Sign in again.";
    return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong.";
  } catch {
    return "Could not reach the server. Check the connection.";
  }
}

// No look-alike characters (0/O, 1/l/I) so it can be read out loud.
function makePassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint32Array(12)), (n) => chars[n % chars.length]).join("");
}

export function UsersManager({ users, roles, currentUserId }: { users: Row[]; roles: Option[]; currentUserId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const label = (role: string) => roles.find((r) => r.value === role)?.label ?? role;

  async function run(fn: () => Promise<string | null>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const err = await fn();
    if (err) setError(err);
    else setNotice(success);
    router.refresh();
    setBusy(false);
    return !err;
  }

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    const name = String(f.get("name")).trim();
    const ok = await run(
      () =>
        send("/api/users", "POST", {
          name,
          email: String(f.get("email")).trim(),
          role: f.get("role"),
          password: f.get("password"),
        }),
      `Added ${name}. Give them the temporary password in person; they can change it after signing in.`,
    );
    if (ok) {
      formEl.reset();
      setPassword("");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Staff accounts</h1>
        <p className="mt-1 text-slate-600">{users.length} {users.length === 1 ? "person" : "people"} can sign in to this workspace.</p>
      </div>

      {error && <p role="alert" className="alert-error">{error}</p>}
      {notice && <p role="status" className="alert-success">{notice}</p>}

      <section className="card" aria-labelledby="add-staff">
        <h2 id="add-staff" className="mb-4 text-lg font-semibold">Add staff</h2>
        <form onSubmit={onAdd} className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="name" className="label">Full name</label>
            <input id="name" name="name" required maxLength={100} autoComplete="off" className="input" />
          </div>
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" name="email" type="email" required maxLength={254} autoComplete="off" className="input" />
          </div>
          <div>
            <label htmlFor="role" className="label">Role</label>
            <select id="role" name="role" required defaultValue="" className="input">
              <option value="" disabled>Choose a role</option>
              {roles.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="password" className="label">Temporary password</label>
            <div className="flex gap-2">
              <input
                id="password"
                name="password"
                type="text"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input font-mono"
              />
              <button type="button" className="btn btn-secondary" onClick={() => setPassword(makePassword())}>
                Generate
              </button>
            </div>
            <p className="mt-1.5 text-sm text-slate-500">At least 8 characters.</p>
          </div>
          <div className="md:col-span-2">
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? "Saving…" : "Add staff"}
            </button>
          </div>
        </form>
      </section>

      <section className="card overflow-x-auto p-0" aria-label="Staff list">
        <table className="w-full min-w-[640px] text-left">
          <thead className="border-b border-slate-200 bg-slate-50 text-sm text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Staff</th>
              <th scope="col" className="px-4 py-3 font-medium">Role</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Added</th>
              <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const self = u.id === currentUserId;
              return (
                <tr key={u.id} className={u.active ? "" : "bg-slate-50 text-slate-500"}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">
                      {u.name} {self && <span className="text-sm font-normal text-slate-500">(you)</span>}
                    </div>
                    <div className="text-sm text-slate-500 break-all">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {self ? (
                      label(u.role)
                    ) : (
                      <select
                        aria-label={`Role for ${u.name}`}
                        value={u.role}
                        disabled={busy}
                        className="input w-40"
                        onChange={(e) =>
                          run(
                            () => send(`/api/users/${u.id}`, "PATCH", { role: e.target.value }),
                            `${u.name} is now ${label(e.target.value)}.`,
                          )
                        }
                      >
                        {roles.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-sm font-medium ${
                        u.active ? "bg-green-50 text-green-800" : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {u.active ? "Active" : "Deactivated"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">{u.added}</td>
                  <td className="px-4 py-3 text-right">
                    {!self && (
                      <button
                        type="button"
                        disabled={busy}
                        className={`btn ${u.active ? "btn-danger" : "btn-secondary"}`}
                        onClick={() => {
                          if (u.active && !confirm(`Deactivate ${u.name}? They are signed out at once and cannot sign in.`)) return;
                          run(
                            () => send(`/api/users/${u.id}`, "PATCH", { active: !u.active }),
                            `${u.name} ${u.active ? "is deactivated" : "can sign in again"}.`,
                          );
                        }}
                      >
                        {u.active ? "Deactivate" : "Reactivate"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
