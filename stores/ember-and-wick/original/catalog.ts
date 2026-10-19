export interface Product {
  sku: string;
  name: string;
  description: string;
  price: string; // USD, two decimals
}

export const catalog: Product[] = [
  { sku: "cedar-ember", name: "Cedar Ember", description: "Smoked cedar and orange peel", price: "12.00" },
  { sku: "sea-salt-fig", name: "Sea Salt Fig", description: "Black fig, sea salt and moss", price: "14.00" },
  { sku: "midnight-amber", name: "Midnight Amber", description: "Amber, vanilla and tonka", price: "16.00" },
];

export function findProduct(sku: string): Product | undefined {
  return catalog.find((p) => p.sku === sku);
}

export function toCents(price: string): number {
  return Math.round(Number(price) * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
