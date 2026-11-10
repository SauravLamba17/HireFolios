// Small JSON fetch for staff screens: returns null on success, or a message to show.
export async function send(url: string, method: "POST" | "PATCH", body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    if (res.status === 401) return "Your session ended. Sign in again.";
    return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong.";
  } catch {
    return "Could not reach the server. Check the connection.";
  }
}
