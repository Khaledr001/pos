import { AccountShell } from "@/components/store/account/account-shell";
import { hasSession } from "@/lib/account-server";
import { requireFeature } from "@/lib/features";

/**
 * Account area frame. Logged-out visitors are sent to /login by each page
 * (`requireSession(path)`), because only the page knows its exact path for
 * the `?next=` return link. /account/trade is the one page a logged-out
 * visitor may open: it forwards to the public /trade page.
 */
export default async function AccountLayout({ children }: LayoutProps<"/account">) {
  await requireFeature("accounts");
  if (!(await hasSession())) return children;
  return <AccountShell>{children}</AccountShell>;
}
