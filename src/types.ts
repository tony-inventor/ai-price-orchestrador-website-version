export interface Product {
  produto: string;
  preco: number;
  is_promo: boolean;
  data?: string;
}

export interface Store {
  id: number;
  name: string;
  filename: string;
  products: Product[] | null;
  status: 'idle' | 'loading' | 'loaded' | 'error';
}

export interface ListItem {
  id: string;
  name: string;
}

export interface OptimizationResult {
  product: string;
  bestStoreId: number;
  bestPrice: number;
  isPromo: boolean;
  worstPrice: number;
  economy: number;
  allMatches: { storeId: number; price: number; isPromo: boolean; name: string }[];
}

export interface StoreSummary {
  storeId: number;
  items: OptimizationResult[];
  total: number;
}
