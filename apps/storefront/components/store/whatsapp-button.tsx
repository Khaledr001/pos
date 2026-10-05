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
      aria-label="Ask on WhatsApp"
      className="group fixed bottom-4 right-4 z-40 inline-flex h-12 items-center justify-center rounded-full bg-[#1f8f4e] px-3.5 font-semibold text-white shadow-lg transition-colors hover:bg-[#187a42] focus-visible:bg-[#187a42]"
    >
      <MessageCircle className="size-5 shrink-0" aria-hidden />
      {/* Icon only until hovered or focused, so the button never covers page content. */}
      <span
        aria-hidden
        className="hidden max-w-0 overflow-hidden whitespace-nowrap transition-[max-width,margin] duration-200 group-hover:ml-2 group-hover:max-w-40 group-focus-visible:ml-2 group-focus-visible:max-w-40 motion-reduce:transition-none sm:inline"
      >
        Ask on WhatsApp
      </span>
    </a>
  );
}
