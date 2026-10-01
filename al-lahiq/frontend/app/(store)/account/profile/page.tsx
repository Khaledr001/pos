import type { Metadata } from "next";
import { ProfileSection } from "@/components/store/account/profile-form";
import { requireSession } from "@/lib/account-server";

export const metadata: Metadata = { title: "Profile and company", robots: { index: false } };

export default async function ProfilePage() {
  await requireSession("/account/profile");
  return (
    <div>
      <h1 className="text-4xl">Profile and company</h1>
      <p className="mt-1 mb-6 text-steel">Keep your contact details and invoice details up to date.</p>
      <div className="rounded-[var(--radius-panel)] border border-galv bg-paper p-5 sm:p-6">
        <ProfileSection />
      </div>
    </div>
  );
}
