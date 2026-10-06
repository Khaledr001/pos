/** One image result from a search provider, normalised across providers. */
export interface ImageHit {
  /** Full-size image URL. Never downloaded by this tool. */
  imageUrl: string;
  thumbnailUrl?: string;
  /** The page the image was found on — what a human opens to check rights. */
  pageUrl: string;
  title?: string;
  width?: number;
  height?: number;
}

export interface ImageSearchProvider {
  readonly name: string;
  search(query: string): Promise<ImageHit[]>;
}

/** The provider is not set up (no key). Carries the instructions to fix it. */
export class ProviderConfigError extends Error {}

/** A provider call that failed in a way retrying will not fix (bad key, exhausted quota). */
export class ProviderFatalError extends Error {}
