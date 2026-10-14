export type SpecMap = Record<string, string>;

export interface Seller {
  id: string;
  slug: string;
  name: string;
  location: string;
  rating: number;
  ratingCount: number;
  /** Fraction of orders dispatched on or before the promised date, 0-1. */
  onTimeRate: number;
  joinedYear: number;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  /** Minor-unit-free KES. Whole numbers only — no floats in money. */
  price: number;
  /** null when never discounted, so we never strike through a real price. */
  compareAtPrice: number | null;
  sellerId: string;
  category: string;
  brand: string;
  rating: number;
  ratingCount: number;
  /** 0 means out of stock. Not a boolean — stock is a number we can decrement. */
  stock: number;
  image: string;
  images: string[];
  specs: SpecMap;
  deliveryFee: number;
  deliveryEstimate: string;
  isOfficialStore: boolean;
  tags: string[];
}