export type CartProduct = {
  id: string;
  name: string;
  price: number;
  image: string;
};

const CART_KEY = 'cryptoro_cart';
const LEGACY_KEY = 'cryptoro_cart_items';

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getCart(): CartProduct[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(CART_KEY) ?? window.localStorage.getItem(LEGACY_KEY) ?? '[]';
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addToCart(product: CartProduct): CartProduct[] {
  if (!canUseStorage()) return [];
  const next = [...getCart(), product];
  window.localStorage.setItem(CART_KEY, JSON.stringify(next));
  return next;
}

export function getCartCount(): number {
  return getCart().length;
}

