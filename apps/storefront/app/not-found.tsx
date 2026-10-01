/**
 * Outside the shop layout, and deliberately free of API calls: this is what a
 * hostname no shop is registered on gets, so it cannot ask for that shop.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-3xl">Nothing here</h1>
      <p className="text-steel">There is no shop at this address, or the page has moved.</p>
    </main>
  );
}
