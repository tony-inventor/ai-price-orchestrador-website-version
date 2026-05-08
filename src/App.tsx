import { useState, useMemo, useCallback, useEffect } from 'react';
import { 
  FileBox, 
  Plus, 
  Trash2, 
  Calculator, 
  FileDown, 
  CheckCircle2, 
  AlertCircle, 
  Store as StoreIcon, 
  TrendingDown, 
  ShoppingBag, 
  Coins,
  Search,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cn } from './lib/utils';
import { Product, Store, ListItem, OptimizationResult, StoreSummary } from './types';

const KNOWN_CSVS = [
  { file: 'dados_epa.csv', label: 'EPA Supermercados' },
  { file: 'dados_farid.csv', label: 'Farid Supermercados' },
  { file: 'dados_bh.csv', label: 'Supermercados BH' },
];

const parseCSV = (text: string): Product[] => {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  
  // Normalize headers
  const header = lines[0]
    .split(',')
    .map(h => h.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
    
  const rows: Product[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/['"]/g, ""));
    if (vals.length < 2) continue;
    
    const row: any = {};
    header.forEach((h, idx) => (row[h] = vals[idx] || ""));
    
    const produto = row["produto"] || row["product"] || row["nome"] || row["item"] || "";
    const precoStr = row["preco"] || row["preço"] || row["price"] || "0";
    const preco = parseFloat(precoStr.replace(",", "."));
    
    const isPromoStr = (row["is_promocao"] || row["is_promoção"] || row["promo"] || "").toLowerCase();
    const isPromo = ["true", "1", "sim", "yes", "s"].includes(isPromoStr);
    
    if (produto && !isNaN(preco) && preco > 0) {
      rows.push({ produto, preco, is_promo: isPromo, data: row["data"] });
    }
  }
  return rows;
};

export default function App() {
  const [stores, setStores] = useState<Store[]>([
    { id: 1, name: 'EPA Supermercados', filename: 'dados_epa.csv', products: null, status: 'idle', enabled: true },
    { id: 2, name: 'Farid Supermercados', filename: 'dados_farid.csv', products: null, status: 'idle', enabled: true },
    { id: 3, name: 'Supermercados BH', filename: 'dados_bh.csv', products: null, status: 'idle', enabled: true },
  ]);
  const [shoppingList, setShoppingList] = useState<ListItem[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [acIndex, setAcIndex] = useState(-1);
  const [results, setResults] = useState<{
    found: OptimizationResult[];
    notFound: string[];
    summaries: StoreSummary[];
    totalOtimizado: number;
    totalSemOtimizar: number;
    economiaTotal: number;
    economiaPct: number;
  } | null>(null);

  const [isCalculated, setIsCalculated] = useState(false);

  // Auto-load on mount
  useEffect(() => {
    stores.forEach(store => {
      if (store.filename && store.status === 'idle') {
        loadStoreCSV(store.id, store.filename, store.name);
      }
    });
  }, []);

  // Load CSV from URL
  const loadStoreCSV = async (storeId: number, file: string, label: string) => {
    setStores(prev => prev.map(s => s.id === storeId ? { ...s, status: 'loading' } : s));
    try {
      const response = await fetch(`/${file}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const text = await response.text();
      const products = parseCSV(text);
      setStores(prev => prev.map(s => s.id === storeId ? { 
        ...s, 
        name: label, 
        filename: file, 
        products, 
        status: 'loaded' 
      } : s));
    } catch (err) {
      setStores(prev => prev.map(s => s.id === storeId ? { ...s, status: 'error' } : s));
    }
  };

  const removeStore = (storeId: number) => {
    setStores(prev => prev.map(s => s.id === storeId ? { 
      ...s, 
      name: `Supermercado ${storeId}`, 
      filename: '', 
      products: null, 
      status: 'idle' 
    } : s));
  };

  // Autocomplete logic
  const allProducts = useMemo(() => {
    const productsMap = new Map<string, { nome: string; preco: number; storeId: number; isPromo: boolean }>();
    stores.filter(s => s.enabled).forEach(store => {
      if (store.products) {
        store.products.forEach(p => {
          const key = p.produto.toLowerCase();
          const existing = productsMap.get(key);
          if (!existing || p.preco < existing.preco) {
            productsMap.set(key, { nome: p.produto, preco: p.preco, storeId: store.id, isPromo: p.is_promo });
          }
        });
      }
    });
    return Array.from(productsMap.values());
  }, [stores]);

  const suggestions = useMemo(() => {
    if (inputValue.trim().length < 2) return [];
    const queryWords = inputValue.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return allProducts
      .filter(p => queryWords.every(w => p.nome.toLowerCase().includes(w)))
      .slice(0, 8);
  }, [inputValue, allProducts]);

  const addItem = (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (!shoppingList.some(item => item.name.toLowerCase() === trimmedName.toLowerCase())) {
      setShoppingList(prev => [...prev, { id: crypto.randomUUID(), name: trimmedName }]);
    }
    setInputValue('');
    setAcIndex(-1);
  };

  const removeItem = (id: string) => {
    setShoppingList(prev => prev.filter(item => item.id !== id));
  };

  // Optimization Logic
  const optimize = useCallback(() => {
    const activeStores = stores.filter(s => s.status === 'loaded' && s.enabled);
    if (activeStores.length === 0 || shoppingList.length === 0) return;

    const found: OptimizationResult[] = [];
    const notFound: string[] = [];

    shoppingList.forEach(listItem => {
      const matches: { storeId: number; preco: number; is_promo: boolean; nome: string }[] = [];
      activeStores.forEach(store => {
        const product = store.products?.find(p => {
          const pName = p.produto.toLowerCase();
          const lName = listItem.name.toLowerCase();
          return pName === lName || pName.includes(lName) || lName.includes(pName);
        });
        if (product) {
          matches.push({ storeId: store.id, preco: product.preco, is_promo: product.is_promo, nome: product.produto });
        }
      });

      if (matches.length === 0) {
        notFound.push(listItem.name);
      } else {
        matches.sort((a, b) => a.preco - b.preco);
        const best = matches[0];
        const worst = matches[matches.length - 1];
        found.push({
          product: listItem.name,
          bestStoreId: best.storeId,
          bestPrice: best.preco,
          isPromo: best.is_promo,
          worstPrice: worst.preco,
          economy: worst.preco - best.preco,
          allMatches: matches.map(m => ({ storeId: m.storeId, price: m.preco, isPromo: m.is_promo, name: m.nome }))
        });
      }
    });

    const summaries: StoreSummary[] = activeStores.map(store => {
      const storeItems = found.filter(f => f.bestStoreId === store.id);
      return {
        storeId: store.id,
        items: storeItems,
        total: storeItems.reduce((acc, curr) => acc + curr.bestPrice, 0)
      };
    }).filter(s => s.items.length > 0);

    const totalOtimizado = found.reduce((acc, curr) => acc + curr.bestPrice, 0);
    const totalSemOtimizar = found.reduce((acc, curr) => acc + curr.worstPrice, 0);
    const economiaTotal = totalSemOtimizar - totalOtimizado;
    const economiaPct = totalSemOtimizar > 0 ? (economiaTotal / totalSemOtimizar) * 100 : 0;

    setResults({
      found,
      notFound,
      summaries,
      totalOtimizado,
      totalSemOtimizar,
      economiaTotal,
      economiaPct
    });
    setIsCalculated(true);
  }, [stores, shoppingList]);

  // PDF Generation
  const generatePDF = () => {
    if (!results) return;
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(22);
    doc.setTextColor(40);
    doc.text('AI Price Orchestrator - Plano de Compras', 10, 20);
    
    // Financial Summary
    doc.setFontSize(14);
    doc.text('Resumo Financeiro', 10, 35);
    doc.setFontSize(12);
    doc.text(`Total Otimizado: R$ ${results.totalOtimizado.toFixed(2)}`, 10, 45);
    doc.text(`Economia Estimada: R$ ${results.economiaTotal.toFixed(2)} (${results.economiaPct.toFixed(1)}%)`, 10, 52);
    
    let yPos = 65;
    
    // Stores Breakdown
    results.summaries.forEach(summary => {
      const store = stores.find(s => s.id === summary.storeId);
      if (yPos > 250) { doc.addPage(); yPos = 20; }
      
      doc.setFontSize(14);
      doc.setTextColor(30, 150, 240);
      doc.text(`${store?.name || 'Loja'} - R$ ${summary.total.toFixed(2)}`, 10, yPos);
      yPos += 10;
      
      const tableData = summary.items.map(item => [
        item.product,
        `R$ ${item.bestPrice.toFixed(2)}`,
        item.isPromo ? 'Sim' : 'Não'
      ]);
      
      autoTable(doc, {
        startY: yPos,
        head: [['Produto', 'Preço', 'Promoção']],
        body: tableData,
        theme: 'striped',
        margin: { left: 10 },
        styles: { fontSize: 10 },
      });
      
      yPos = (doc as any).lastAutoTable.finalY + 15;
    });

    doc.save('plano_de_compras.pdf');
  };

  const loadDemo = () => {
    KNOWN_CSVS.forEach((csv, idx) => {
      loadStoreCSV(idx + 1, csv.file, csv.label);
    });
    const demoItems = ['Arroz', 'Feijão', 'Leite', 'Café', 'Batata', 'Banana'];
    setShoppingList(demoItems.map(name => ({ id: crypto.randomUUID(), name })));
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans selection:bg-cyan-500/30">
      <main className="max-w-5xl mx-auto px-4 py-8 md:py-12 space-y-6">
        {/* Header Block */}
        <header className="bg-slate-900/40 border border-slate-800/50 rounded-3xl p-8 md:p-12 text-center shadow-2xl backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4 text-white">
              Planejador de compras otimizado
            </h1>
            <p className="text-slate-400 text-sm md:text-lg max-w-2xl mx-auto font-medium">
              Monte sua lista, carregue os CSVs e veja o roteiro de compras mais barato distribuído por supermercado.
            </p>
          </motion.div>
        </header>

        {/* Stores Panel */}
        <section className="bg-slate-900/40 border border-slate-800/50 rounded-3xl p-6 md:p-8 shadow-xl backdrop-blur-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-black text-cyan-400 uppercase tracking-[0.2em]">
              Supermercados
            </h2>
            <button 
              onClick={loadDemo}
              className="text-[10px] font-black text-slate-400 hover:text-white transition-all uppercase tracking-[0.2em] border-b border-white/10 hover:border-white px-1"
            >
              Usar Demo
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {stores.map(store => (
              <div 
                key={store.id}
                className={cn(
                  "flex items-center justify-between p-4 rounded-xl border transition-all duration-300 relative overflow-hidden",
                  !store.enabled 
                    ? "bg-red-950/20 border-red-500/30" 
                    : store.status === 'loaded'
                      ? "bg-[#064e3b]/10 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.05)]" 
                      : "bg-slate-800/40 border-slate-700/50"
                )}
              >
                <div className="flex items-center gap-3 z-10">
                  <div className={cn(
                    "w-2 h-2 rounded-full transition-all duration-300",
                    !store.enabled 
                      ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" 
                      : store.status === 'loaded' 
                        ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" 
                        : "bg-slate-600"
                  )} />
                  <div className="flex flex-col">
                    <p className={cn(
                      "text-xs md:text-sm font-bold tracking-tight transition-colors duration-500",
                      !store.enabled ? "text-red-200/60" : store.status === 'loaded' ? "text-white" : "text-slate-400"
                    )}>
                      {store.name}
                    </p>
                    <p className="text-[10px] opacity-40 font-medium">
                      {store.status === 'loaded' ? `${store.products?.length} produtos` : 'escolher CSV'}
                    </p>
                  </div>
                </div>
                
                <button 
                  onClick={() => setStores(prev => prev.map(s => s.id === store.id ? { ...s, enabled: !s.enabled } : s))}
                  className={cn(
                    "relative inline-flex h-4 w-8 items-center rounded-full transition-all duration-300 focus:outline-none z-10",
                    store.enabled ? (store.status === 'loaded' ? "bg-emerald-500" : "bg-cyan-500") : "bg-red-500/50"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-300",
                      store.enabled ? "translate-x-4.5" : "translate-x-1"
                    )}
                  />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Shopping List Panel */}
        <section className="bg-slate-900/40 border border-slate-800/50 rounded-3xl p-6 md:p-8 shadow-xl backdrop-blur-sm">
          <h2 className="text-xs font-black text-cyan-400 uppercase tracking-[0.2em] mb-6">
            Minha lista de compras
          </h2>
          
          <div className="relative mb-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1 group">
                <input 
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (acIndex >= 0 && suggestions[acIndex]) {
                        addItem(suggestions[acIndex].nome);
                      } else {
                        addItem(inputValue);
                      }
                    } else if (e.key === 'ArrowDown') {
                      setAcIndex(prev => Math.min(prev + 1, suggestions.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      setAcIndex(prev => Math.max(prev - 1, -1));
                    }
                  }}
                  placeholder="Nome do produto..."
                  className={cn(
                    "w-full rounded-xl py-4 px-6 focus:outline-none text-base font-bold transition-all placeholder:text-slate-500",
                    inputValue.trim() 
                      ? "bg-red-900/40 border border-red-500/30 text-red-100" 
                      : "bg-slate-950/80 border border-slate-700/50 text-white"
                  )}
                />
              </div>
              <button 
                onClick={() => addItem(inputValue)}
                className="py-4 px-8 bg-[#0d9488] hover:bg-[#0f766e] text-white font-black uppercase text-xs tracking-widest rounded-xl transition-all active:scale-95 shadow-lg shadow-teal-900/20"
              >
                Adicionar
              </button>
            </div>

            {/* Autocomplete */}
            <AnimatePresence>
              {suggestions.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="absolute top-full left-0 right-0 mt-2 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden"
                >
                  {suggestions.map((p, i) => (
                    <div 
                      key={`${p.nome}-${i}`}
                      onClick={() => addItem(p.nome)}
                      className={cn(
                        "group flex items-center justify-between p-4 cursor-pointer border-b border-slate-800 last:border-0 transition-colors text-sm",
                        acIndex === i ? "bg-cyan-500/10" : "hover:bg-slate-800/50"
                      )}
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-100">{p.nome}</span>
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest">{stores.find(s => s.id === p.storeId)?.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                         <span className="font-mono font-bold text-cyan-400">R$ {p.preco.toFixed(2)}</span>
                         {p.isPromo && <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 font-black uppercase rounded-sm">Promo</span>}
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
            {shoppingList.map((item) => (
              <motion.div 
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                key={item.id}
                className="group flex items-center justify-between py-3 px-1 border-b border-slate-800/50 hover:border-slate-600 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/30" />
                  <span className="text-sm font-bold text-slate-300 group-hover:text-white transition-colors">{item.name}</span>
                </div>
                <button 
                  onClick={() => removeItem(item.id)}
                  className="p-2 text-slate-600 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </motion.div>
            ))}
            {shoppingList.length === 0 && (
              <div className="py-12 text-center opacity-30">
                <ShoppingBag className="w-8 h-8 mx-auto mb-3" />
                <p className="text-[10px] uppercase font-bold tracking-widest">0 itens na lista</p>
              </div>
            )}
          </div>
          
          <div className="mt-6 pt-4 text-[10px] text-slate-500 uppercase tracking-widest font-black">
            {shoppingList.length} itens na lista
          </div>
        </section>
        
        {/* Results / Empty View Transition */}
        <AnimatePresence mode="wait">
          {isCalculated && results ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              key="results"
              className="space-y-8"
            >
              {/* Results Content (keep current logic but update styles) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-900/40 border border-slate-800/50 p-8 rounded-3xl shadow-xl">
                   <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-2">Total Otimizado</p>
                   <p className="text-3xl font-black">R$ {results.totalOtimizado.toFixed(2)}</p>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 p-8 rounded-3xl shadow-xl">
                   <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest mb-2">Economia Total</p>
                   <div className="flex items-baseline gap-3">
                     <p className="text-3xl font-black text-emerald-400">R$ {results.economiaTotal.toFixed(2)}</p>
                     <span className="text-xs font-bold text-emerald-500/50">({results.economiaPct.toFixed(1)}%)</span>
                   </div>
                </div>
                <div className="bg-slate-900/40 border border-slate-800/50 p-8 rounded-3xl shadow-xl">
                   <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-2">Lojas Utilizadas</p>
                   <p className="text-3xl font-black">{results.summaries.length}</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 pb-12">
                <button 
                  onClick={generatePDF}
                  className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white font-black uppercase tracking-widest text-xs rounded-xl border border-slate-700 transition-all flex items-center justify-center gap-3"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Exportar PDF</span>
                </button>
                <button 
                  onClick={() => { setIsCalculated(false); setResults(null); }}
                  className="px-12 py-4 bg-slate-900/50 text-slate-400 hover:text-white font-black uppercase tracking-widest text-xs rounded-xl border border-slate-800 transition-all"
                >
                  Revisar Lista
                </button>
              </div>
            </motion.div>
          ) : (
            <button 
              disabled={stores.filter(s => s.status === 'loaded' && s.enabled).length < 2 || shoppingList.length === 0}
              onClick={optimize}
              className="w-full py-5 bg-[#0f172a] hover:bg-[#1e293b] border border-slate-700/50 text-slate-400 hover:text-white disabled:opacity-20 font-black uppercase tracking-[0.3em] text-xs transition-all flex items-center justify-center gap-3 rounded-xl shadow-2xl active:scale-[0.98]"
            >
              <span>Calcular plano de compras otimizado</span>
            </button>
          )}
        </AnimatePresence>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.1);
          border-radius: 99px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.2);
        }
      `}} />
    </div>
  );
}
