// Русский комментарий: конфиг ручного пересчета фиксированных цен с учетом средней доставки.
export const PRICING_RECALC_CONFIG = {
  // Русский комментарий: финальные цены округляем вверх до шага (например 10 ₽).
  priceRoundingStepRub: 10,
  cities: [
    { city: 'Москва', share: 0.32, zip: '115432', street: 'Проспект Андропова, 1' },
    { city: 'Санкт-Петербург', share: 0.14, zip: '191025', street: 'Невский проспект, 28' },
    { city: 'Казань', share: 0.08, zip: '420111', street: 'Улица Баумана, 19' },
    { city: 'Екатеринбург', share: 0.07, zip: '620014', street: 'Проспект Ленина, 24/8' },
    { city: 'Новосибирск', share: 0.07, zip: '630099', street: 'Красный проспект, 25' },
    { city: 'Краснодар', share: 0.07, zip: '350063', street: 'Улица Красная, 68' },
    { city: 'Нижний Новгород', share: 0.06, zip: '603005', street: 'Улица Большая Покровская, 15' },
    { city: 'Ростов-на-Дону', share: 0.06, zip: '344002', street: 'Улица Большая Садовая, 43' },
    { city: 'Самара', share: 0.07, zip: '443010', street: 'Улица Куйбышева, 84' },
    { city: 'Уфа', share: 0.06, zip: '450077', street: 'Улица Ленина, 5/4' },
  ],
  groups: {
    devices: {
      label: 'Устройства',
      slugs: ['vspomnit', 'plaud-note', 'plaud-note-pro', 'notepin'],
      pickupRequest: {
        // Русский комментарий: репрезентативный профиль отправления для расчета средней доставки по группе.
        item: { weight: 80, length: 86, width: 54, height: 3, qty: 1, price: 1000 },
      },
    },
    accessories: {
      label: 'Аксессуары',
      slugs: ['accessories'],
      pickupRequest: {
        item: { weight: 220, length: 140, width: 110, height: 40, qty: 1, price: 1000 },
      },
    },
    subscriptions: {
      label: 'Подписки AI',
      slugs: ['plaud-ai-pro-12m', 'plaud-ai-unlimited-12m'],
      fixedSurchargeRub: 0,
    },
  },
};
