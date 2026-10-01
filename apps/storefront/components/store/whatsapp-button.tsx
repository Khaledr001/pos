import { MessageCircle } from "lucide-react";
import { getStore } from "@/lib/data";
import { whatsappLink } from "@/lib/format";

export async function WhatsAppButton() {
  const store = await getStore();
  if (!store.whatsapp) return null;
  return (
    <a
      href={whatsappLink(store.whatsapp, `Hello ${store.name}, I have a question about a product.`)}
      target="_blank"
      rel="noopener"
      className="fixed bottom-4 right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-[#1f8f4e] px-4 font-semibold text-white shadow-lg hover:brightness-95"
    >
      <MessageCircle className="size-5" aria-hidden />
      <span className="hidden sm:inline">Ask on WhatsApp</span>
      <span className="sr-only sm:hidden">Ask on WhatsApp</span>
    </a>
  );
}
