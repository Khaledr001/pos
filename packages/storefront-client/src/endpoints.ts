import type { ApiClient } from './client.ts';
import type { CreateQuoteInput, Paged, QuoteSummary, QuoteView, StockAlertInput } from './types.ts';

/** Back-in-stock alerts. Public: a guest can subscribe. */
export const stockAlertsApi = (api: ApiClient) => ({
  subscribe: (input: StockAlertInput) => api.post<{ subscribed: true }>('/stock-alerts', input),
  unsubscribe: (token: string) => api.post<{ unsubscribed: true }>(`/stock-alerts/unsubscribe/${token}`),
});

/** Trade quotes. Needs a signed-in shopper. */
export const quotesApi = (api: ApiClient) => ({
  create: (input: CreateQuoteInput) => api.post<QuoteView>('/quotes', input),
  list: (page = 1) => api.get<Paged<QuoteSummary>>(`/quotes?page=${page}`),
  get: (id: string) => api.get<QuoteView>(`/quotes/${id}`),
  accept: (id: string) => api.post<QuoteView>(`/quotes/${id}/accept`),
  decline: (id: string) => api.post<QuoteView>(`/quotes/${id}/decline`),
});
