export type CartProduct = {
  id: string;
  name: string;
  price: number;
  image: string;
  qty?: number;
};

const CART_KEY = 'cryptoro_cart';
const LEGACY_KEY = 'cryptoro_cart_items';
const COUNT_KEY = 'cryptoro_cart_count';

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getCart(): CartProduct[] {
  if (!canUseStorage()) return [];
  try {
    // Поддержка текущего и legacy ключа корзины.
    const raw = window.localStorage.getItem(CART_KEY) ?? window.localStorage.getItem(LEGACY_KEY) ?? '[]';
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object' && item.id && item.name)
      .map((item) => ({
        id: String(item.id),
        name: String(item.name),
        price: Number(item.price) || 0,
        image: String(item.image || ''),
        qty: Math.max(1, Number(item.qty) || 1)
      }));
  } catch {
    return [];
  }
}

export function addToCart(product: CartProduct): CartProduct[] {
  if (!canUseStorage()) return [];
  const current = getCart();
  const idx = current.findIndex((item) => item.id === product.id);
  let next: CartProduct[];
  if (idx >= 0) {
    // Если товар уже есть в корзине, увеличиваем количество.
    next = current.map((item, i) =>
      i === idx
        ? {
            ...item,
            qty: Math.max(1, Number(item.qty) || 1) + Math.max(1, Number(product.qty) || 1)
          }
        : item
    );
  } else {
    next = [
      ...current,
      {
        ...product,
        qty: Math.max(1, Number(product.qty) || 1)
      }
    ];
  }
  window.localStorage.setItem(CART_KEY, JSON.stringify(next));
  window.localStorage.setItem(COUNT_KEY, String(next.reduce((acc, item) => acc + Math.max(1, Number(item.qty) || 1), 0)));
  return next;
}

export function getCartCount(): number {
  return getCart().reduce((acc, item) => acc + Math.max(1, Number(item.qty) || 1), 0);
}

export function updateCartQty(id: string, qty: number): CartProduct[] {
  if (!canUseStorage()) return [];
  // Не даем опуститься ниже 1.
  const normalizedQty = Math.max(1, Math.floor(Number(qty) || 1));
  const next = getCart().map((item) => (item.id === id ? { ...item, qty: normalizedQty } : item));
  window.localStorage.setItem(CART_KEY, JSON.stringify(next));
  window.localStorage.setItem(COUNT_KEY, String(next.reduce((acc, item) => acc + Math.max(1, Number(item.qty) || 1), 0)));
  return next;
}

export function removeFromCart(id: string): CartProduct[] {
  if (!canUseStorage()) return [];
  const next = getCart().filter((item) => item.id !== id);
  window.localStorage.setItem(CART_KEY, JSON.stringify(next));
  window.localStorage.setItem(COUNT_KEY, String(next.reduce((acc, item) => acc + Math.max(1, Number(item.qty) || 1), 0)));
  return next;
}

export function clearCart(): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(CART_KEY, JSON.stringify([]));
  window.localStorage.removeItem(LEGACY_KEY);
  window.localStorage.setItem(COUNT_KEY, '0');
}
