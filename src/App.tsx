import { useState, useMemo, useCallback } from 'react';
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
    { id: 1, name: 'Supermercado 1', filename: '', products: null, status: 'idle' },
    { id: 2, name: 'Supermercado 2', filename: '', products: null, status: 'idle' },
    { id: 3, name: 'Supermercado 3', filename: '', products: null, status: 'idle' },
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
    stores.forEach(store => {
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
    const activeStores = stores.filter(s => s.status === 'loaded');
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
    <div className="min-h-screen bg-[#0A0A0A] text-[#E0E0E0] font-sans selection:bg-[#C5A059]/30">
      {/* Refined background accent */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#C5A059]/10 to-transparent" />
      </div>

      <main className="relative max-w-6xl mx-auto px-6 py-16">
        {/* Header */}
        <header className="mb-16 border-l-2 border-[#C5A059] pl-6">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <h1 className="text-5xl font-serif italic tracking-tight text-[#C5A059] mb-2 uppercase">
              AI Price Orchestrator
            </h1>
            <p className="text-white/40 text-[10px] uppercase tracking-[0.4em] font-bold">Optimized Shopping Intelligence</p>
          </motion.div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left Column: Stores and List */}
          <div className="lg:col-span-12 xl:col-span-4 space-y-10">
            {/* Stores Panel */}
            <section className="bg-[#0F0F0F] border border-white/10 p-8 shadow-2xl relative overflow-hidden">
               <div className="absolute -top-4 -right-4 text-[#C5A059]/5 rotate-12">
                 <StoreIcon className="w-24 h-24" />
               </div>
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold">
                  Data Repositories
                </h2>
                <button 
                  onClick={loadDemo}
                  className="text-[10px] font-bold text-[#C5A059] hover:text-white transition-colors uppercase tracking-[0.1em] border-b border-[#C5A059]/30"
                >
                  Load Demo
                </button>
              </div>
              
              <div className="space-y-4">
                {stores.map(store => (
                  <div 
                    key={store.id}
                    className={cn(
                      "flex items-center justify-between p-5 border transition-all duration-300",
                      store.status === 'loaded' 
                        ? "bg-[#C5A059]/5 border-[#C5A059]/30" 
                        : "bg-black/20 border-white/5 hover:border-white/10 cursor-pointer"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-1 h-3",
                        store.status === 'loaded' ? "bg-[#C5A059]" : "bg-white/10"
                      )} />
                      <div>
                        <p className={cn("text-sm font-semibold tracking-tight", store.status === 'loaded' ? "text-white" : "text-white/40")}>
                          {store.name}
                        </p>
                        <p className="text-[9px] font-mono opacity-20 mt-1 uppercase tracking-tighter">
                          {store.status === 'loaded' ? `${store.products?.length} items recognized` : 'Awaiting data sync'}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                       {store.status === 'loaded' ? (
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeStore(store.id); }}
                          className="text-white/20 hover:text-red-500 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      ) : (
                        <div className="flex gap-1 overflow-hidden">
                          {KNOWN_CSVS.filter(csv => !stores.some(s => s.filename === csv.file)).slice(0, 1).map(csv => (
                            <button
                              key={csv.file}
                              onClick={() => loadStoreCSV(store.id, csv.file, csv.label)}
                              className="text-[9px] px-2 py-1 bg-white/5 border border-white/10 rounded-sm hover:bg-white/10 transition-colors font-bold uppercase tracking-widest text-white/50"
                            >
                              Sync {csv.label.split(' ')[0]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Shopping List Panel */}
            <section className="bg-[#0F0F0F] border border-white/10 p-8 shadow-2xl">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-8">
                Shopping Registry
              </h2>
              
              <div className="relative mb-8">
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
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
                      placeholder="Add item reference..."
                      className="w-full bg-black/40 border border-white/10 py-4 pl-12 pr-4 focus:outline-none focus:border-[#C5A059]/40 text-sm font-mono transition-all placeholder:text-white/10"
                    />
                  </div>
                  <button 
                    onClick={() => addItem(inputValue)}
                    className="p-4 bg-[#C5A059] hover:bg-[#D5B069] transition-all active:scale-95"
                  >
                    <Plus className="w-5 h-5 text-black" />
                  </button>
                </div>

                {/* Autocomplete */}
                <AnimatePresence>
                  {suggestions.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="absolute top-full left-0 right-0 mt-1 bg-[#141414] border border-white/20 shadow-2xl z-50 overflow-hidden"
                    >
                      {suggestions.map((p, i) => (
                        <div 
                          key={`${p.nome}-${i}`}
                          onClick={() => addItem(p.nome)}
                          className={cn(
                            "group flex items-center justify-between p-4 cursor-pointer border-b border-white/5 last:border-0 transition-colors",
                            acIndex === i ? "bg-[#C5A059]/10" : "hover:bg-white/5"
                          )}
                        >
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-white/80">{p.nome}</span>
                            <span className="text-[9px] text-white/20 uppercase tracking-widest">{stores.find(s => s.id === p.storeId)?.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                             <span className="text-xs font-mono font-bold text-[#C5A059]">R$ {p.preco.toFixed(2)}</span>
                             {p.isPromo && <span className="text-[9px] border border-[#C5A059]/30 text-[#C5A059] px-2 py-0.5 font-bold uppercase tracking-tighter">Promo</span>}
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="space-y-1 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                {shoppingList.map((item) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    key={item.id}
                    className="group flex items-center justify-between p-4 border-b border-white/5 hover:bg-white/[0.02] transition-all"
                  >
                    <span className="text-sm text-white/60 group-hover:text-white/90 transition-colors">{item.name}</span>
                    <button 
                      onClick={() => removeItem(item.id)}
                      className="p-1.5 text-white/10 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
                {shoppingList.length === 0 && (
                  <div className="py-20 text-center">
                    <ShoppingBag className="w-10 h-10 text-white/5 mx-auto mb-4" />
                    <p className="text-white/20 text-xs uppercase tracking-widest font-bold">List Empty</p>
                  </div>
                )}
              </div>
              
              <div className="mt-8 pt-8 border-t border-white/5 flex items-center justify-between text-[10px] text-white/20 uppercase tracking-[0.2em] font-bold">
                <span>Registry Counter</span>
                <span className="text-[#C5A059] font-mono">{shoppingList.length}</span>
              </div>
            </section>
            
            <button 
              disabled={stores.filter(s => s.status === 'loaded').length < 2 || shoppingList.length === 0}
              onClick={optimize}
              className="w-full py-6 bg-[#C5A059] text-black hover:bg-[#D5B069] disabled:bg-white/5 disabled:text-white/10 font-bold uppercase tracking-[0.4em] text-xs transition-all flex items-center justify-center gap-3 active:scale-[0.98] shadow-2xl"
            >
              <Calculator className="w-4 h-4" />
              <span>Execute Orchestration</span>
            </button>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-12 xl:col-span-8">
            <AnimatePresence mode="wait">
              {isCalculated && results ? (
                <motion.div 
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  key="results"
                  className="space-y-12"
                >
                  {/* Summary Metrics */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-[#0F0F0F] border border-white/10 p-8 shadow-xl">
                       <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.2em] mb-4">Total Optimized</p>
                       <p className="text-4xl font-serif italic">R$ {results.totalOtimizado.toFixed(2)}</p>
                    </div>
                    <div className="bg-[#0F0F0F] border border-white/10 p-8 shadow-xl relative overflow-hidden">
                       <div className="absolute top-0 right-0 w-24 h-24 bg-[#C5A059]/5 blur-3xl rounded-full" />
                       <p className="text-[10px] text-[#C5A059] font-bold uppercase tracking-[0.2em] mb-4">Surplus Savored</p>
                       <div className="flex items-baseline gap-3">
                         <p className="text-4xl font-serif italic text-[#C5A059]">R$ {results.economiaTotal.toFixed(2)}</p>
                         <span className="text-xs font-mono text-white/20">({results.economiaPct.toFixed(1)}%)</span>
                       </div>
                    </div>
                    <div className="bg-[#0F0F0F] border border-white/10 p-8 shadow-xl">
                       <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.2em] mb-4">Active Nodes</p>
                       <p className="text-4xl font-serif italic">{results.summaries.length}</p>
                    </div>
                  </div>

                  {/* Store Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {results.summaries.map((summary, idx) => {
                      const store = stores.find(s => s.id === summary.storeId);
                      return (
                        <motion.div 
                          key={summary.storeId}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className="bg-[#0F0F0F] border border-white/10 shadow-2xl"
                        >
                          <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                            <div>
                              <h3 className="font-serif text-xl italic text-white/90">{store?.name}</h3>
                              <p className="text-[9px] text-white/20 uppercase tracking-[0.3em] mt-1 font-bold">{summary.items.length} units audited</p>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-mono font-bold text-[#C5A059]">R$ {summary.total.toFixed(2)}</p>
                            </div>
                          </div>
                          <div className="p-6 space-y-4 max-h-[350px] overflow-y-auto custom-scrollbar">
                            {summary.items.map((item, i) => (
                              <div key={i} className="flex justify-between items-center text-xs group">
                                <div className="flex items-center gap-3">
                                  <div className="w-0.5 h-3 bg-[#C5A059]/40" />
                                  <span className="text-white/50 group-hover:text-white/80 transition-colors">{item.product}</span>
                                  {item.isPromo && <span className="text-[8px] border border-[#C5A059]/10 text-[#C5A059]/40 px-1 py-0.5 font-bold">PROMO</span>}
                                </div>
                                <span className="font-mono text-white/30 group-hover:text-white/60">R$ {item.bestPrice.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>

                  {/* Table Summary */}
                  <div className="bg-[#0F0F0F] border border-white/10 overflow-hidden hidden md:block shadow-2xl">
                    <div className="p-8 border-b border-white/5">
                      <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#C5A059] font-bold">
                        Detailed Expenditure Analysis
                      </h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse font-mono">
                        <thead>
                          <tr className="bg-white/[0.03] text-[9px] text-white/20 uppercase tracking-[0.2em] font-black">
                            <th className="p-6">Registry Entity</th>
                            <th className="p-6">Target Node</th>
                            <th className="p-6">Unit Value</th>
                            <th className="p-4 text-right">Delta Advantage</th>
                          </tr>
                        </thead>
                        <tbody className="text-[11px] divide-y divide-white/5">
                          {results.found.map((f, i) => (
                            <tr key={i} className="hover:bg-white/[0.01] transition-colors">
                              <td className="p-6 text-white/70">{f.product}</td>
                              <td className="p-6">
                                <span className="text-[#C5A059] italic border-b border-[#C5A059]/10">
                                  {stores.find(s => s.id === f.bestStoreId)?.name}
                                </span>
                              </td>
                              <td className="p-6 font-bold text-white/80">R$ {f.bestPrice.toFixed(2)}</td>
                              <td className="p-4 text-right">
                                {f.economy > 0 ? (
                                  <span className="text-[#C5A059]/50 font-bold">R$ {f.economy.toFixed(2)}</span>
                                ) : (
                                  <span className="text-white/5">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                          {results.notFound.map((item, i) => (
                            <tr key={`nf-${i}`} className="bg-red-500/[0.02] opacity-40">
                              <td className="p-6 text-red-400 italic">{item}</td>
                              <td className="p-6 text-[9px] text-red-500 uppercase tracking-widest font-bold" colSpan={3}>Entity Missing from Nodes</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-6 pb-24">
                    <button 
                      onClick={generatePDF}
                      className="flex-1 py-5 border border-[#C5A059] text-[#C5A059] hover:bg-[#C5A059] hover:text-black font-bold uppercase tracking-[0.3em] text-[10px] transition-all flex items-center justify-center gap-3 shadow-xl"
                    >
                      <FileDown className="w-4 h-4" />
                      <span>Export Statement</span>
                    </button>
                    <button 
                      onClick={() => { setIsCalculated(false); setResults(null); }}
                      className="px-12 py-5 bg-white/5 text-white/20 hover:text-white/60 font-bold uppercase tracking-[0.3em] text-[10px] transition-all border border-transparent hover:border-white/10"
                    >
                      Revise Audit
                    </button>
                  </div>
                </motion.div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center py-40 px-10 text-center bg-[#0F0F0F] border border-white/5 shadow-2xl relative">
                  <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#C5A059]/20 to-transparent" />
                  <motion.div 
                    animate={{ opacity: [0.2, 0.4, 0.2] }}
                    transition={{ repeat: Infinity, duration: 4 }}
                    className="mb-12 text-[#C5A059]/30"
                  >
                    <FileBox className="w-20 h-20" />
                  </motion.div>
                  <h3 className="text-4xl font-serif italic mb-6 tracking-tight">Node Sync Awaiting</h3>
                  <p className="text-white/20 text-sm max-w-sm mb-16 leading-relaxed uppercase tracking-widest font-bold text-[10px]">
                    Load repository data and define registry requirements to initialize price orchestration engine.
                  </p>
                  
                  <div className="flex gap-20 text-left border-t border-white/5 pt-12">
                    <div className="flex flex-col gap-2">
                      <span className="text-[#C5A059] font-mono text-xs font-bold">01</span>
                      <span className="text-[9px] uppercase tracking-[0.2em] text-white/20 font-black">Sync Nodes</span>
                    </div>
                    <div className="flex flex-col gap-2">
                       <span className="text-[#C5A059] font-mono text-xs font-bold">02</span>
                       <span className="text-[9px] uppercase tracking-[0.2em] text-white/20 font-black">Register Items</span>
                    </div>
                    <div className="flex flex-col gap-2">
                       <span className="text-[#C5A059] font-mono text-xs font-bold">03</span>
                       <span className="text-[9px] uppercase tracking-[0.2em] text-white/20 font-black">Analyze</span>
                    </div>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(197, 160, 89, 0.05);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(197, 160, 89, 0.2);
        }
      `}} />
    </div>
  );
}
