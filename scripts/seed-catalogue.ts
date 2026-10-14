/*
  The larger catalogue, kept separate from seed.ts.

  Filters are only provable against variety: a six-item catalogue where two
  products share a category and three share a price band cannot distinguish a
  working price filter from a broken one. This file exists so the filter tests
  have something to filter.

  Split out rather than merged into seed.ts so the original hand-written
  products stay readable side by side — they are the ones with copy written to
  match the HIG-derived layout, and they are what the UI was reviewed against.

  Run: npx tsx scripts/seed-catalogue.ts
  Idempotent: keyed on slug, so re-running updates in place.
*/
import { branch, close, sql } from "./db";
import type { Row } from "./db";

type Seed = {
  slug: string;
  title: string;
  description: string;
  price: string;
  /** null = never discounted, so the -0% badge stays impossible. */
  compareAt: string | null;
  stock: number;
  seller: string;
  category: string;
  brand: string;
  rating: string;
  ratingCount: number;
  deliveryFee: string;
  etaDays: number;
  official?: boolean;
  specs: Record<string, string>;
  tags: string[];
};

/*
  Deliberately spans the dimensions the filters sort on:
    price      150 to 89,900 — four orders of magnitude
    rating     3.4 to 4.9, including one below the 4.5 "good" line
    stock      0, low (1-5), and plentiful
    category   all eight, so a category filter can empty a result set
    seller     unevenly, so seller filtering is observable
    discount   about a third, so the "on sale" toggle has both outcomes
*/
const CATALOGUE: Seed[] = [
  /* ---------------------------------- Phones & Tablets */
  {
    slug: "tecno-spark-30-128gb",
    title: "TECNO Spark 30 128GB Dual SIM Android Phone — Cosmic Blue",
    description:
      "6.78-inch 90Hz display, 8GB RAM, 128GB storage and a 5000mAh battery. Sold in Kenya with a 12-month warranty.",
    price: "18999.00",
    compareAt: "21500.00",
    stock: 34,
    seller: "karibu-tech",
    category: "phones-and-tablets",
    brand: "TECNO",
    rating: "4.10",
    ratingCount: 287,
    deliveryFee: "200.00",
    etaDays: 2,
    official: true,
    specs: { Display: '6.78" 90Hz', RAM: "8GB", Storage: "128GB", Battery: "5000mAh" },
    tags: ["tecno", "android", "smartphone", "budget"],
  },
  {
    slug: "itel-a70-64gb",
    title: "itel A70 64GB Android Smartphone — Obsidian Black",
    description:
      "Entry-level Android phone with a 6.6-inch display, 4GB RAM and a 5000mAh battery. Good first phone or backup handset.",
    price: "11500.00",
    compareAt: null,
    stock: 56,
    seller: "karibu-tech",
    category: "phones-and-tablets",
    brand: "itel",
    rating: "3.80",
    ratingCount: 96,
    deliveryFee: "200.00",
    etaDays: 2,
    specs: { Display: '6.6"', RAM: "4GB", Storage: "64GB", Battery: "5000mAh" },
    tags: ["itel", "android", "budget", "smartphone"],
  },
  {
    slug: "infinix-hot-40-256gb",
    title: "Infinix Hot 40 256GB Android Phone — Polar Black",
    description:
      "256GB of storage and a 90Hz display at an entry price. Runs Android 13 with 6GB of RAM.",
    price: "17499.00",
    compareAt: "19999.00",
    stock: 3,
    seller: "karibu-tech",
    category: "phones-and-tablets",
    brand: "Infinix",
    rating: "3.60",
    ratingCount: 41,
    deliveryFee: "200.00",
    etaDays: 3,
    specs: { Display: '6.56" 90Hz', RAM: "6GB", Storage: "256GB", Battery: "5000mAh" },
    tags: ["infinix", "android", "smartphone"],
  },
  {
    slug: "samsung-galaxy-tab-a9-64gb",
    title: "Samsung Galaxy Tab A9 64GB Wi-Fi Tablet — Silver",
    description:
      "10.4-inch tablet for reading, streaming and coursework. Stereo speakers, 8GB RAM, 64GB expandable.",
    price: "32900.00",
    compareAt: "37500.00",
    stock: 12,
    seller: "nairobi-electronics",
    category: "phones-and-tablets",
    brand: "Samsung",
    rating: "4.50",
    ratingCount: 620,
    deliveryFee: "150.00",
    etaDays: 1,
    official: true,
    specs: { Display: '10.4"', RAM: "8GB", Storage: "64GB", Battery: "7040mAh" },
    tags: ["samsung", "tablet", "android"],
  },
  {
    slug: "xiaomi-redmi-13c-128gb",
    title: "Xiaomi Redmi 13C 128GB Dual SIM — Midnight Black",
    description:
      "One of the best-selling handsets in Kenya. 128GB storage, 5000mAh battery, 3.5mm jack and a dual SIM tray.",
    price: "16999.00",
    compareAt: "18499.00",
    stock: 78,
    seller: "karibu-tech",
    category: "phones-and-tablets",
    brand: "Xiaomi",
    rating: "4.30",
    ratingCount: 2140,
    deliveryFee: "200.00",
    etaDays: 2,
    official: true,
    specs: { Display: '6.74"', RAM: "6GB", Storage: "128GB", Battery: "5000mAh" },
    tags: ["xiaomi", "redmi", "android", "smartphone"],
  },

  /* ---------------------------------- Electronics */
  {
    slug: "anker-usb-c-cable-2m",
    title: "Anker USB-C to USB-C Cable 2m, 100W — Braided Nylon",
    description:
      "100W Power Delivery, 480Mbps data. The braided jacket survives being coiled in a bag every day.",
    price: "1450.00",
    compareAt: "2200.00",
    stock: 210,
    seller: "nairobi-electronics",
    category: "electronics",
    brand: "Anker",
    rating: "4.70",
    ratingCount: 5400,
    deliveryFee: "150.00",
    etaDays: 1,
    official: true,
    specs: { Length: "2m", Power: "100W PD", Data: "480Mbps", Warranty: "18 months" },
    tags: ["usb-c", "charger", "cable", "anker"],
  },
  {
    slug: "oraimon-20000mah-powerbank",
    title: "Oraimon Power Bank 20000mAh Fast Charging — Black",
    description:
      "A no-name alternative to the Anker, at roughly half the price. 20000mAh, dual USB output.",
    price: "4200.00",
    compareAt: "6500.00",
    stock: 64,
    seller: "savannah-home",
    category: "electronics",
    brand: "Oraimon",
    rating: "3.40",
    ratingCount: 218,
    deliveryFee: "200.00",
    etaDays: 3,
    specs: { Capacity: "20000mAh", Output: "18W", Ports: "2x USB-A, 1x USB-C" },
    tags: ["power bank", "charger", "budget"],
  },
  {
    slug: "jbl-tune-510bt-headphones",
    title: "JBL Tune 510BT Wireless On-Ear Headphones — Black",
    description:
      "40-hour battery, Pure Bass sound and a foldable design. Bluetooth 5.0 with multipoint pairing.",
    price: "8900.00",
    compareAt: "10500.00",
    stock: 27,
    seller: "nairobi-electronics",
    category: "electronics",
    brand: "JBL",
    rating: "4.40",
    ratingCount: 1560,
    deliveryFee: "150.00",
    etaDays: 1,
    official: true,
    specs: { Battery: "40 hours", Connectivity: "Bluetooth 5.0", Weight: "160g" },
    tags: ["headphones", "bluetooth", "audio", "jbl"],
  },
  {
    slug: "sony-wh-1000xm5-headphones",
    title: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones — Black",
    description:
      "The reference for travel headphones. Eight microphones, adaptive noise cancelling, 30-hour battery.",
    price: "89999.00",
    compareAt: null,
    stock: 5,
    seller: "nairobi-electronics",
    category: "electronics",
    brand: "Sony",
    rating: "4.90",
    ratingCount: 480,
    deliveryFee: "0.00",
    etaDays: 1,
    official: true,
    specs: { Battery: "30 hours", Noise: "Adaptive ANC", Weight: "250g", Warranty: "1 year" },
    tags: ["headphones", "noise cancelling", "sony", "premium"],
  },
  {
    slug: "kaspersky-antivirus-1-device",
    title: "Kaspersky Total Security 1 Device, 1 Year Subscription",
    description:
      "Digital licence for one PC. Real-time antivirus, web protection and a password manager.",
    price: "3200.00",
    compareAt: "5400.00",
    stock: 999,
    seller: "nairobi-electronics",
    category: "electronics",
    brand: "Kaspersky",
    rating: "4.20",
    ratingCount: 730,
    deliveryFee: "0.00",
    etaDays: 1,
    official: true,
    specs: { Devices: "1", Term: "1 year", Delivery: "Email licence key" },
    tags: ["software", "antivirus", "digital"],
  },
  {
    slug: "samsung-45w-charger",
    title: "Samsung 45W Super Fast Wall Charger — White",
    description:
      "USB-C Power Delivery for phones, tablets and small laptops. Cable not included.",
    price: "4200.00",
    compareAt: null,
    stock: 88,
    seller: "nairobi-electronics",
    category: "electronics",
    brand: "Samsung",
    rating: "4.00",
    ratingCount: 310,
    deliveryFee: "150.00",
    etaDays: 1,
    official: true,
    specs: { Output: "45W", Port: "USB-C", Cable: "Not included" },
    tags: ["charger", "usb-c", "samsung"],
  },
  {
    slug: "logitech-mouse-b07",
    title: "Logitech B07 USB Wireless Mouse — Graphite",
    description:
      "Silent clicks, 12-month battery and a tiny receiver that works up to 10 metres away.",
    price: "1850.00",
    compareAt: "2400.00",
    stock: 145,
    seller: "nairobi-electronics",
    category: "electronics",
    brand: "Logitech",
    rating: "4.50",
    ratingCount: 890,
    deliveryFee: "150.00",
    etaDays: 1,
    specs: { Connectivity: "2.4GHz wireless", Battery: "12 months", Buttons: "3" },
    tags: ["mouse", "wireless", "logitech", "accessories"],
  },

  /* ---------------------------------- Home & Kitchen */
  {
    slug: "ramtons-5l-pressure-cooker",
    title: "Ramtons 5L Electric Pressure Cooker — Stainless Steel",
    description:
      "Cuts cooking time roughly in half. Non-stick inner pot, five programmes including beans and maize.",
    price: "12500.00",
    compareAt: "15000.00",
    stock: 19,
    seller: "savannah-home",
    category: "home-and-kitchen",
    brand: "Ramtons",
    rating: "4.20",
    ratingCount: 640,
    deliveryFee: "200.00",
    etaDays: 4,
    official: true,
    specs: { Capacity: "5 litres", Programmes: "5", Pot: "Non-stick", Warranty: "2 years" },
    tags: ["pressure cooker", "kitchen", "electric"],
  },
  {
    slug: "philips-airfryer-4.1l",
    title: "Philips Airfryer 4.1L Rapid Air — Black",
    description:
      "Cooks with a fraction of the oil. Fits a kilogram of chips or eight portions, with a dishwasher-safe basket.",
    price: "34999.00",
    compareAt: "41999.00",
    stock: 7,
    seller: "savannah-home",
    category: "home-and-kitchen",
    brand: "Philips",
    rating: "4.70",
    ratingCount: 1180,
    deliveryFee: "200.00",
    etaDays: 3,
    official: true,
    specs: { Capacity: "4.1 litres", Power: "1500W", Dishwasher: "Basket yes", Warranty: "2 years" },
    tags: ["airfryer", "kitchen", "philips", "electric"],
  },
  {
    slug: "miktex-24-piece-crockery-set",
    title: "Miktex 24-Piece Stoneware Crockery Set — White",
    description:
      "Six place settings with side plates and bowls. Stoneware, so it goes from freezer to oven.",
    price: "8900.00",
    compareAt: null,
    stock: 31,
    seller: "savannah-home",
    category: "home-and-kitchen",
    brand: "Miktex",
    rating: "3.90",
    ratingCount: 155,
    deliveryFee: "200.00",
    etaDays: 4,
    specs: { Pieces: "24", Material: "Stoneware", Microwave: "Yes", PlaceSettings: "6" },
    tags: ["crockery", "dinnerware", "kitchen"],
  },
  {
    slug: "centenary-bed-mattress-4x6",
    title: "Centergy Orthopaedic 4x6 Foot Mattress — Medium Firm",
    description:
      "Spring mattress with a foam topper, aimed at side sleepers and anyone with a bad back.",
    price: "28999.00",
    compareAt: "36000.00",
    stock: 11,
    seller: "savannah-home",
    category: "home-and-kitchen",
    brand: "Centergy",
    rating: "4.30",
    ratingCount: 420,
    deliveryFee: "400.00",
    etaDays: 5,
    official: true,
    specs: { Size: "4x6 ft", Firmness: "Medium firm", Spring: "Pocket spring", Warranty: "5 years" },
    tags: ["mattress", "bedroom", "furniture"],
  },
  {
    slug: "sunbeam-2-slice-toaster",
    title: "Sunbeam 2-Slice Chrome Toaster",
    description:
      "Six browning settings, a defrost slot and a crumb tray that slides out.",
    price: "4800.00",
    compareAt: "6200.00",
    stock: 42,
    seller: "savannah-home",
    category: "home-and-kitchen",
    brand: "Sunbeam",
    rating: "3.80",
    ratingCount: 205,
    deliveryFee: "200.00",
    etaDays: 4,
    specs: { Slots: "2", Settings: "6", CrumbTray: "Yes", Warranty: "2 years" },
    tags: ["toaster", "kitchen", "breakfast"],
  },
  {
    slug: "thermos-1l-water-bottle",
    title: "Thermos 1L Stainless Steel Water Bottle — Matte Black",
    description:
      "Keeps drinks hot for 16 hours or cold for 24. Fits a standard cup holder.",
    price: "3400.00",
    compareAt: null,
    stock: 120,
    seller: "savannah-home",
    category: "home-and-kitchen",
    brand: "Thermos",
    rating: "4.60",
    ratingCount: 720,
    deliveryFee: "180.00",
    etaDays: 3,
    specs: { Capacity: "1 litre", Hot: "16 hours", Cold: "24 hours", Material: "Stainless steel" },
    tags: ["flask", "water bottle", "outdoors"],
  },
  {
    slug: "philips-iron-steam",
    title: "Philips Steam Iron 2000W — Blue",
    description:
      "Steam iron with a ceramic soleplate and a drip-stop system. Includes a fill and carry-on base.",
    price: "9500.00",
    compareAt: "11500.00",
    stock: 0,
    seller: "savannah-home",
    category: "home-and-kitchen",
    brand: "Philips",
    rating: "4.50",
    ratingCount: 330,
    deliveryFee: "200.00",
    etaDays: 4,
    specs: { Power: "2000W", Soleplate: "Ceramic", Steam: "30g/min", Warranty: "2 years" },
    tags: ["iron", "laundry", "philips"],
  },

  /* ---------------------------------- Fashion */
  {
    slug: "adidas-sports-shoes-42",
    title: "Adidas Running Shoes, Men's — Size 42 (EU 43), Black/White",
    description:
      "Lightweight mesh running shoe with a foam midsole. Built for road running and gym work.",
    price: "12500.00",
    compareAt: "15500.00",
    stock: 24,
    seller: "savannah-home",
    category: "fashion",
    brand: "Adidas",
    rating: "4.40",
    ratingCount: 640,
    deliveryFee: "180.00",
    etaDays: 3,
    specs: { Size: "42 (EU 43)", Upper: "Engineered mesh", Sole: "Rubber", Warranty: "6 months" },
    tags: ["shoes", "running", "adidas", "footwear"],
  },
  {
    slug: "levis-501-jeans-32",
    title: "Levi's 501 Original Fit Jeans — W32/L32, Dark Indigo",
    description:
      "The original button-fly jean in dark indigo cotton. Unslim through the thigh.",
    price: "11500.00",
    compareAt: null,
    stock: 38,
    seller: "savannah-home",
    category: "fashion",
    brand: "Levi's",
    rating: "4.60",
    ratingCount: 890,
    deliveryFee: "180.00",
    etaDays: 3,
    specs: { Size: "W32/L32", Colour: "Dark indigo", Fit: "Regular", Material: "100% cotton" },
    tags: ["jeans", "denim", "levis", "clothing"],
  },
  {
    slug: "hypebeast-cap-unisex",
    title: "Cotton Baseball Cap, Unisex — Black",
    description:
      "Six-panel cotton cap with an adjustable strap. One size fits most.",
    price: "1900.00",
    compareAt: "2500.00",
    stock: 95,
    seller: "savannah-home",
    category: "fashion",
    brand: "No Brand",
    rating: "3.50",
    ratingCount: 112,
    deliveryFee: "180.00",
    etaDays: 3,
    specs: { Material: "Cotton", Panels: "6", Closure: "Adjustable strap" },
    tags: ["cap", "hat", "accessories", "unisex"],
  },
  {
    slug: "handbag-leather-brown",
    title: "Genuine Leather Handbag with Detachable Strap — Brown",
    description:
      "Full-grain leather with a detachable shoulder strap, lined interior and three pockets.",
    price: "18500.00",
    compareAt: "24000.00",
    stock: 4,
    seller: "savannah-home",
    category: "fashion",
    brand: "Artisan",
    rating: "4.00",
    ratingCount: 78,
    deliveryFee: "200.00",
    etaDays: 5,
    specs: { Material: "Genuine leather", Strap: "Detachable", Lining: "Yes", Pockets: "3" },
    tags: ["handbag", "leather", "bag", "women"],
  },
  {
    slug: "polo-shirt-cotton-medium",
    title: "Cotton Polo Shirt, Men's — Medium, Navy",
    description:
      "Piqué cotton polo with a three-button placket. Shrinks slightly on the first wash.",
    price: "3200.00",
    compareAt: "4500.00",
    stock: 67,
    seller: "savannah-home",
    category: "fashion",
    brand: "No Brand",
    rating: "3.70",
    ratingCount: 143,
    deliveryFee: "180.00",
    etaDays: 3,
    specs: { Size: "Medium", Colour: "Navy", Material: "Piqué cotton", Fit: "Regular" },
    tags: ["polo", "shirt", "clothing", "men"],
  },

  /* ---------------------------------- Beauty */
  {
    slug: "nivea-body-lotion-400ml",
    title: "NIVEA Body Lotion 400ml — Nourishing Care",
    description:
      "Everyday body lotion with shea butter and vitamin E. Absorbs without residue.",
    price: "1850.00",
    compareAt: "2200.00",
    stock: 150,
    seller: "savannah-home",
    category: "beauty",
    brand: "NIVEA",
    rating: "4.50",
    ratingCount: 1230,
    deliveryFee: "180.00",
    etaDays: 3,
    official: true,
    specs: { Size: "400ml", Skin: "All types", Key: "Shea butter", Warranty: "Not applicable" },
    tags: ["lotion", "body care", "nivea", "moisturiser"],
  },
  {
    slug: "carlisle-black-soap",
    title: "Carlisle Black Soap 500ml — Traditional",
    description:
      "Traditional Kenyan black soap, made from ash and shea. Commonly used for hands and bathing.",
    price: "600.00",
    compareAt: null,
    stock: 300,
    seller: "savannah-home",
    category: "beauty",
    brand: "Carlisle",
    rating: "4.20",
    ratingCount: 640,
    deliveryFee: "150.00",
    etaDays: 3,
    specs: { Size: "500ml", Type: "Bar and liquid", Origin: "Kenya", Use: "Hands and bathing" },
    tags: ["soap", "black soap", "natural", "kenyan"],
  },
  {
    slug: "oats-soap-multipack-4",
    title: "Colgate Oats Soap, 4-Pack — 150g Each",
    description:
      "Moisturising oat soap, sold as a four-pack. Individually wrapped, so it survives a long delivery.",
    price: "950.00",
    compareAt: "1200.00",
    stock: 260,
    seller: "savannah-home",
    category: "beauty",
    brand: "Colgate",
    rating: "3.60",
    ratingCount: 88,
    deliveryFee: "150.00",
    etaDays: 3,
    specs: { Packs: "4", Weight: "150g each", Key: "Oat extract" },
    tags: ["soap", "body care", "value pack"],
  },
  {
    slug: "sun-protection-spf50-50ml",
    title: "Sunscreen SPF 50+ 50ml — Broad Spectrum",
    description:
      "Non-greasy broad-spectrum sunscreen suited to equatorial sun. Not for use on broken skin.",
    price: "2400.00",
    compareAt: "3200.00",
    stock: 84,
    seller: "savannah-home",
    category: "beauty",
    brand: "No Brand",
    rating: "4.00",
    ratingCount: 210,
    deliveryFee: "180.00",
    etaDays: 3,
    specs: { Size: "50ml", Protection: "SPF 50+", Spectrum: "Broad", Finish: "Non-greasy" },
    tags: ["sunscreen", "spf", "skincare"],
  },

  /* ---------------------------------- Sports */
  {
    slug: "yonex-badminton-racket",
    title: "Yonex Badminton Racket Astrox 77 — Pre-Stringed",
    description:
      "Graphite shaft, strung at 9kg. Comes in a protective sleeve with an overgrip.",
    price: "28500.00",
    compareAt: "34000.00",
    stock: 9,
    seller: "nairobi-electronics",
    category: "sports",
    brand: "Yonex",
    rating: "4.80",
    ratingCount: 340,
    deliveryFee: "150.00",
    etaDays: 1,
    official: true,
    specs: { Shaft: "Graphite", Weight: "85g", String: "9kg", Case: "Included" },
    tags: ["badminton", "racket", "yonex"],
  },
  {
    slug: "gym-mat-6mm",
    title: "Exercise Yoga Mat 6mm Non-Slip — Charcoal",
    description:
      "High-density EVA, 6mm thick, with alignment lines. Rolls down to about 10cm.",
    price: "2900.00",
    compareAt: "3900.00",
    stock: 72,
    seller: "nairobi-electronics",
    category: "sports",
    brand: "No Brand",
    rating: "4.20",
    ratingCount: 460,
    deliveryFee: "150.00",
    etaDays: 1,
    specs: { Thickness: "6mm", Material: "EVA", Length: "183cm", Grip: "Textured" },
    tags: ["yoga", "mat", "gym", "exercise"],
  },
  {
    slug: "football-nike-size-4",
    title: "Nike Strike Football, Size 4 — White/Black",
    description:
      "Match-quality ball with a thermally bonded cover. Sizes 4 and 5 available.",
    price: "4200.00",
    compareAt: null,
    stock: 41,
    seller: "nairobi-electronics",
    category: "sports",
    brand: "Nike",
    rating: "4.60",
    ratingCount: 380,
    deliveryFee: "150.00",
    etaDays: 1,
    official: true,
    specs: { Size: "4", Cover: "Thermally bonded", Panels: "12", Use: "Match and training" },
    tags: ["football", "soccer", "ball", "nike"],
  },
  {
    slug: "jumprope-speed",
    title: "Speed Jump Rope with Bearings — Black",
    description:
      "Ball-bearing rope that spins smoothly on concrete. Adjustable length and a padded handle.",
    price: "1600.00",
    compareAt: "2400.00",
    stock: 88,
    seller: "nairobi-electronics",
    category: "sports",
    brand: "No Brand",
    rating: "3.80",
    ratingCount: 190,
    deliveryFee: "150.00",
    etaDays: 1,
    specs: { Type: "Speed rope", Bearings: "Yes", Length: "Adjustable", Handle: "Padded" },
    tags: ["jump rope", "gym", "cardio"],
  },
  {
    slug: "water-bottle-1l-sports-squeeze",
    title: "Sports Squeeze Water Bottle 1L — BPA Free",
    description:
      "Soft squeeze bottle with a pull spout. Fits a bike cage and stands up on its own.",
    price: "950.00",
    compareAt: null,
    stock: 190,
    seller: "nairobi-electronics",
    category: "sports",
    brand: "No Brand",
    rating: "4.00",
    ratingCount: 275,
    deliveryFee: "150.00",
    etaDays: 1,
    specs: { Capacity: "1 litre", Material: "BPA free", Spout: "Pull", Fits: "Bike cage" },
    tags: ["water bottle", "sports", "gym"],
  },

  /* ---------------------------------- Groceries */
  {
    slug: "sugar-1kg",
    title: "Kabras White Sugar 1kg",
    description:
      "Refined white sugar in a 1kg bag. Sealed retail packaging.",
    price: "180.00",
    compareAt: null,
    stock: 800,
    seller: "savannah-home",
    category: "groceries",
    brand: "Kabras",
    rating: "4.30",
    ratingCount: 320,
    deliveryFee: "150.00",
    etaDays: 2,
    specs: { Weight: "1kg", Type: "White sugar", Brand: "Kabras" },
    tags: ["sugar", "groceries", "staples"],
  },
  {
    slug: "royco-cooking-oil-1l",
    title: "Royco Cooking Oil 1L — Sunflower",
    description:
      "Sunflower cooking oil in a one-litre bottle. A common everyday staple in Kenyan kitchens.",
    price: "420.00",
    compareAt: "480.00",
    stock: 540,
    seller: "savannah-home",
    category: "groceries",
    brand: "Royco",
    rating: "4.10",
    ratingCount: 210,
    deliveryFee: "150.00",
    etaDays: 2,
    specs: { Volume: "1 litre", Type: "Sunflower", Brand: "Royco" },
    tags: ["cooking oil", "groceries", "staples"],
  },
  {
    slug: "kenya-tea-250g",
    title: "Kenyan Black Tea Leaves 250g — Premium",
    description:
      "Broken-leaf black tea, the grade most commonly sold in Kenya. Packs loose into a tin.",
    price: "650.00",
    compareAt: "800.00",
    stock: 220,
    seller: "savannah-home",
    category: "groceries",
    brand: "Kenya Tea",
    rating: "4.50",
    ratingCount: 940,
    deliveryFee: "150.00",
    etaDays: 2,
    specs: { Weight: "250g", Type: "Black tea, broken leaf", Origin: "Kenya" },
    tags: ["tea", "groceries", "kenyan"],
  },
  {
    slug: "unga-2kg-maize-meal",
    title: "Fortified Maize Flour 2kg",
    description:
      "Vitamin-fortified maize flour for ugali and porridge. Two-kilogram bag.",
    price: "290.00",
    compareAt: null,
    stock: 640,
    seller: "savannah-home",
    category: "groceries",
    brand: "No Brand",
    rating: "4.20",
    ratingCount: 460,
    deliveryFee: "150.00",
    etaDays: 2,
    specs: { Weight: "2kg", Type: "Maize flour", Fortified: "Yes" },
    tags: ["unga", "maize", "flour", "groceries"],
  },
  {
    slug: "milk-1l-packet",
    title: "Fresh Long-Life Milk 1L — Full Cream",
    description:
      "UHT full-cream milk in a one-litre carton. Keeps for months sealed, so it ships well.",
    price: "230.00",
    compareAt: "260.00",
    stock: 480,
    seller: "savannah-home",
    category: "groceries",
    brand: "No Brand",
    rating: "3.90",
    ratingCount: 180,
    deliveryFee: "150.00",
    etaDays: 2,
    specs: { Volume: "1 litre", Type: "Full cream", Treatment: "UHT" },
    tags: ["milk", "dairy", "groceries"],
  },

  /* ---------------------------------- Automotive */
  {
    slug: "car-wash-shampoo-1l",
    title: "Car Wash Shampoo 1L — Concentrated",
    description:
      "Concentrated car shampoo that dilutes down for a full bucket. Low-foam rinse.",
    price: "1250.00",
    compareAt: "1600.00",
    stock: 56,
    seller: "nairobi-electronics",
    category: "automotive",
    brand: "No Brand",
    rating: "4.00",
    ratingCount: 240,
    deliveryFee: "180.00",
    etaDays: 2,
    specs: { Volume: "1 litre", Type: "Concentrated", Foam: "Low", Dilution: "1:20" },
    tags: ["car wash", "shampoo", "automotive"],
  },
  {
    slug: "car-phone-holder-magnetic",
    title: "Magnetic Car Phone Holder — Dashboard Mount",
    description:
      "Twelve N52 magnets, a strong ball joint and a dash or windscreen mount in the box.",
    price: "1450.00",
    compareAt: "2200.00",
    stock: 103,
    seller: "nairobi-electronics",
    category: "automotive",
    brand: "No Brand",
    rating: "4.30",
    ratingCount: 610,
    deliveryFee: "180.00",
    etaDays: 2,
    specs: { Magnets: "12x N52", Mount: "Dash or windscreen", Rotation: "360 degrees" },
    tags: ["phone holder", "car", "automotive", "mount"],
  },
  {
    slug: "engine-oil-5w30-4l",
    title: "Engine Oil 5W-30 Fully Synthetic 4L",
    description:
      "Fully synthetic 5W-30 for modern petrol engines. Check the viscosity in your manual before using.",
    price: "6800.00",
    compareAt: "7500.00",
    stock: 26,
    seller: "nairobi-electronics",
    category: "automotive",
    brand: "No Brand",
    rating: "4.40",
    ratingCount: 150,
    deliveryFee: "180.00",
    etaDays: 2,
    specs: { Volume: "4 litres", Viscosity: "5W-30", Type: "Fully synthetic" },
    tags: ["engine oil", "car", "automotive", "servicing"],
  },
  {
    slug: "car-air-freshener",
    title: "Car Air Freshener — Pine, Liquid Type",
    description:
      "Clip-on liquid freshener. Lasts about six weeks in normal Nairobi traffic.",
    price: "550.00",
    compareAt: null,
    stock: 175,
    seller: "nairobi-electronics",
    category: "automotive",
    brand: "No Brand",
    rating: "3.40",
    ratingCount: 320,
    deliveryFee: "180.00",
    etaDays: 2,
    specs: { Type: "Liquid", Scent: "Pine", Lasts: "About 6 weeks", Mount: "Vent clip" },
    tags: ["air freshener", "car", "automotive"],
  },
];

console.log(`seeding ${CATALOGUE.length} products\n`);

const sellerRows = await sql<{ id: string; slug: string }>(
  `SELECT id, slug FROM sellers`,
);
const sellerIds = new Map(sellerRows.map((s) => [s.slug, s.id]));

const categoryRows = await sql<{ id: string; slug: string }>(
  `SELECT id, slug FROM categories`,
);
const categoryIds = new Map(categoryRows.map((c) => [c.slug, c.id]));

// Verify every seller and category referenced actually exists, up front.
//
// Failing on the first INSERT with a foreign key error names the constraint
// but not which of the forty rows is at fault, and the message quotes the
// slug, so the wrong row looks guilty. Checking the whole set first turns a
// forty-line bisect into one list.
const missingSellers = [...new Set(CATALOGUE.map((p) => p.seller))].filter(
  (s) => !sellerIds.has(s),
);
const missingCategories = [
  ...new Set(CATALOGUE.map((p) => p.category)),
].filter((c) => !categoryIds.has(c));

if (missingSellers.length > 0) {
  console.error(`unknown sellers: ${missingSellers.join(", ")}`);
  console.error("run scripts/seed.ts first to create sellers");
  await close();
  process.exit(1);
}
if (missingCategories.length > 0) {
  console.error(`unknown categories: ${missingCategories.join(", ")}`);
  await close();
  process.exit(1);
}

let written = 0;
const officialSellers = new Set<string>();

for (const p of CATALOGUE) {
  await sql<Row>(
    `INSERT INTO products
       (slug, title, description, price, compare_at_price, stock, seller_id,
        category_id, brand, rating, rating_count, delivery_fee,
        delivery_estimate_days, specs, tags, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,'active')
     ON CONFLICT (slug) DO UPDATE SET
       title = EXCLUDED.title, description = EXCLUDED.description,
       price = EXCLUDED.price, compare_at_price = EXCLUDED.compare_at_price,
       stock = EXCLUDED.stock, brand = EXCLUDED.brand,
       rating = EXCLUDED.rating, rating_count = EXCLUDED.rating_count,
       delivery_fee = EXCLUDED.delivery_fee,
       delivery_estimate_days = EXCLUDED.delivery_estimate_days,
       specs = EXCLUDED.specs, tags = EXCLUDED.tags,
       status = 'active'`,
    [
      p.slug,
      p.title,
      p.description,
      p.price,
      p.compareAt,
      p.stock,
      sellerIds.get(p.seller),
      categoryIds.get(p.category),
      p.brand,
      p.rating,
      p.ratingCount,
      p.deliveryFee,
      p.etaDays,
      JSON.stringify(p.specs),
      p.tags,
    ],
  );
  written++;
  if (p.official) officialSellers.add(p.seller);
}

for (const slug of officialSellers) {
  await sql(
    `UPDATE sellers SET is_official_store = true, is_verified = true WHERE id = $1`,
    [sellerIds.get(slug)],
  );
}

console.log(`seeded ${written} products\n`);

/* ------------------------------------------------------------ verification */

const spread = await sql<Row>(`
  SELECT
    count(*)::int                                        AS total,
    count(*) FILTER (WHERE stock = 0)::int               AS out_of_stock,
    count(*) FILTER (WHERE stock > 0 AND stock <= 5)::int AS low_stock,
    count(*) FILTER (WHERE compare_at_price IS NOT NULL)::int AS discounted,
    count(DISTINCT category_id)::int                     AS categories,
    count(DISTINCT brand)::int                           AS brands,
    min(price)                                           AS cheapest,
    max(price)                                           AS priciest,
    min(rating)::numeric(3,2)                            AS worst_rating,
    max(rating)::numeric(3,2)                            AS best_rating
    FROM products WHERE status = 'active'
`);

console.log("--- catalogue spread (what the filters have to work across) ---");
const s = spread[0];
console.log(`  products        ${s.total}`);
console.log(`  categories      ${s.categories}`);
console.log(`  brands          ${s.brands}`);
console.log(`  price range     ${s.cheapest} to ${s.priciest}`);
console.log(`  rating range    ${s.worst_rating} to ${s.best_rating}`);
console.log(`  discounted      ${s.discounted}`);
console.log(`  out of stock    ${s.out_of_stock}`);
console.log(`  low stock       ${s.low_stock}`);

const unsearchable = await sql<Row>(
  `SELECT count(*)::int AS n FROM products WHERE search_vector IS NULL`,
);
console.log(
  Number(unsearchable[0].n) === 0
    ? "\npass every product has a populated search_vector"
    : `\nFAIL ${unsearchable[0].n} products have no search_vector`,
);
if (Number(unsearchable[0].n) > 0) process.exitCode = 1;

await close();
console.log(`\ndone. branch: ${branch()}`);
