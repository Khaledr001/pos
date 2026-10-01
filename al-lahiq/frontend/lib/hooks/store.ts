"use client";

import type { CartView, Customer } from "@al-lahiq/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-browser";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<Customer>("/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useCart() {
  return useQuery({ queryKey: ["cart"], queryFn: () => api.get<CartView>("/cart") });
}

/** Cart mutations. Each returns the updated cart, which replaces the cached one. */
export function useCartActions() {
  const qc = useQueryClient();
  const onSuccess = (cart: CartView) => qc.setQueryData(["cart"], cart);

  const add = useMutation({
    mutationFn: (input: { variantId: string; uom?: string; quantity: number }) => api.post<CartView>("/cart/items", input),
    onSuccess,
  });
  const update = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) => api.patch<CartView>(`/cart/items/${id}`, { quantity }),
    onSuccess,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<CartView>(`/cart/items/${id}`),
    onSuccess,
  });
  const applyCoupon = useMutation({
    mutationFn: (code: string) => api.post<CartView>("/cart/coupon", { code }),
    onSuccess,
  });
  const removeCoupon = useMutation({
    mutationFn: () => api.delete<CartView>("/cart/coupon"),
    onSuccess,
  });
  return { add, update, remove, applyCoupon, removeCoupon };
}

/** After login/logout the cart and prices change: refetch everything visitor-specific. */
export function useSessionChanged() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
