import { describe, expect, it } from "vitest";
import { pickTop, scoreHit, type ScoredHit } from "./scoring.js";

const product = { name: "modi shower haed", brand: "modi" };
const hit = (over: Record<string, unknown> = {}) => ({
  imageUrl: "https://cdn.example.com/a.jpg",
  pageUrl: "https://www.modielectric.com/shower-head",
  title: "Modi Shower Head chrome",
  width: 1000,
  height: 1000,
  ...over,
});

describe("scoreHit", () => {
  it("drops non-https and small images", () => {
    expect(scoreHit(hit({ imageUrl: "http://x.com/a.jpg" }), product, "q")).toBeNull();
    expect(scoreHit(hit({ width: 300, height: 900 }), product, "q")).toBeNull();
  });

  it("ranks a brand site above a stock-photo site and a social post", () => {
    const brand = scoreHit(hit(), product, "q")!;
    const stock = scoreHit(hit({ pageUrl: "https://www.shutterstock.com/x" }), product, "q")!;
    const social = scoreHit(hit({ pageUrl: "https://www.pinterest.com/pin/1" }), product, "q")!;
    expect(brand.score).toBeGreaterThan(stock.score + 30);
    expect(brand.score).toBeGreaterThan(social.score + 30);
  });

  it("prefers square images and matching titles; penalises a conflicting size", () => {
    const square = scoreHit(hit(), product, "q")!;
    const banner = scoreHit(hit({ width: 2000, height: 500 }), product, "q")!;
    expect(square.score).toBeGreaterThan(banner.score);
    const fan = { name: 'modi 16" stand fan', brand: "modi" };
    const right = scoreHit(hit({ pageUrl: "https://shop.example.com/x", title: "Modi 16 inch stand fan" }), fan, "q")!;
    const wrong = scoreHit(hit({ pageUrl: "https://shop.example.com/x", title: "Modi 18 inch stand fan" }), fan, "q")!;
    expect(right.score).toBeGreaterThan(wrong.score + 15);
  });

  it("stays within 0-100", () => {
    const s = scoreHit(hit(), product, "q")!.score;
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe("pickTop", () => {
  const mk = (n: number, domain: string, score: number): ScoredHit => ({
    imageUrl: `https://${domain}/${n}.jpg`, pageUrl: `https://${domain}/p`, sourceDomain: domain, score, query: "q",
  });
  it("dedupes by image, caps two per domain and keeps the best N", () => {
    const top = pickTop([mk(1, "a.com", 90), mk(1, "a.com", 90), mk(2, "a.com", 80), mk(3, "a.com", 70), mk(4, "b.com", 60), mk(5, "c.com", 50)], 3);
    expect(top.map((h) => h.imageUrl)).toEqual(["https://a.com/1.jpg", "https://a.com/2.jpg", "https://b.com/4.jpg"]);
  });
});
