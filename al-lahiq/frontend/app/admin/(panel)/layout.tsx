import { LoginRedirect } from "@/components/admin/login-redirect";
import { getStaffSession } from "@/components/admin/session";
import { AdminShell } from "@/components/admin/shell";

/** Every panel page needs a staff session; checked on the server with the visitor's cookies. */
export default async function PanelLayout({ children }: LayoutProps<"/admin">) {
  const staff = await getStaffSession();
  // The login redirect needs the current path (for ?next=), which only client components can read.
  if (!staff) return <LoginRedirect />;
  if (staff === "busy") return <Busy />;
  return <AdminShell staff={staff}>{children}</AdminShell>;
}

function Busy() {
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4">
      <div className="max-w-md rounded-[var(--radius-panel)] border border-galv bg-paper p-6 text-center">
        <h1 className="text-2xl">The admin is busy right now</h1>
        <p className="mt-2 text-steel">Too many requests reached the server in the last minute. Wait a moment, then reload the page.</p>
        {/* A full reload on purpose: it re-runs the session check. */}
        <a href="" className="mt-4 inline-block font-semibold text-pipe underline underline-offset-2">
          Reload the page
        </a>
      </div>
    </main>
  );
}
