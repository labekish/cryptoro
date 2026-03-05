export type CdekCalcItem = {
  weight: number;
  length: number;
  width: number;
  height: number;
  qty: number;
  price?: number;
};

export type CdekCalcRequest = {
  items: CdekCalcItem[];
  city: string;
  pvzId: string | null;
  cod?: boolean;
  itemsTotal?: number;
  deliveryType?: 'pickup' | 'door';
  zip?: string;
  street?: string;
  apartment?: string;
  orderTotal?: number;
};

export async function fetchCdekCalculation(payload: CdekCalcRequest): Promise<any> {
  const response = await fetch('/api/cdek/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.json().catch(() => null);
}

export async function fetchCdekPvz(city: string): Promise<any> {
  const response = await fetch(`/api/cdek/pvz?city=${encodeURIComponent(city)}`);
  return response.json().catch(() => null);
}
