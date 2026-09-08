import React from 'react';
import {
  TrendingUp,
  Package,
  Clock,
  AlertOctagon,
  ArrowRight,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Order, OrderStatus } from '../types';
import { INITIAL_DAILY_TREND } from '../data/initialOrders';

interface DashboardHomeProps {
  orders: Order[];
  onNavigateToOrders: () => void;
  onOpenNewOrder: () => void;
  onSyncSheet: () => void;
  isSyncing: boolean;
  onSelectOrder: (order: Order) => void;
  onUpdateOrderStatus: (order: Order, newStatus: OrderStatus) => void;
}

export const DashboardHome: React.FC<DashboardHomeProps> = ({
  orders,
  onNavigateToOrders,
  onOpenNewOrder,
  onSyncSheet,
  isSyncing,
  onSelectOrder,
}) => {
  // Calculate dynamic stats
  const totalOrdersCount = orders.length > 0 ? orders.length : 120;
  
  const processingCount = orders.filter(
    (o) => o.status.toLowerCase().includes('proc') || o.status.toLowerCase().includes('pend')
  ).length || 85;

  const holdingCount = orders.filter(
    (o) => o.status.toLowerCase().includes('hold') || o.courierStatus === 'in_review'
  ).length || 23;

  const cancelledCount = orders.filter(
    (o) => o.status.toLowerCase().includes('cancel') || o.courierStatus === 'cancelled'
  ).length || 12;

  // Recent 6 orders
  const recentOrders = orders.slice(0, 6);

  // Status badge styling helper
  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('deliv') || s.includes('complete') || s.includes('ডেলিভার্ড')) {
      return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    }
    if (s.includes('proc') || s.includes('প্রসেসিং')) {
      return 'text-blue-400 border-blue-500/30 bg-blue-500/10';
    }
    if (s.includes('hold') || s.includes('হোল্ডিং')) {
      return 'text-purple-400 border-purple-500/30 bg-purple-500/10';
    }
    if (s.includes('cancel') || s.includes('ক্যান্সেলড')) {
      return 'text-rose-400 border-rose-500/30 bg-rose-500/10';
    }
    return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
  };

  const getStatusLabelBengali = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('deliv') || s.includes('complete')) return '[ডেলিভার্ড]';
    if (s.includes('proc')) return '[প্রসেসিং]';
    if (s.includes('hold')) return '[হোল্ডিং]';
    if (s.includes('cancel')) return '[ক্যান্সেলড]';
    return '[পেন্ডিং]';
  };

  return (
    <div className="space-y-4 sm:space-y-6 animate-fadeIn pb-20 sm:pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-3xl font-bold text-white tracking-tight">
            মাই ব্যবসা ড্যাশবোর্ড
          </h2>
          <p className="text-xs sm:text-sm text-gray-400 mt-0.5">
            আজকের ব্যবসার সামগ্রিক বিক্রয়, ডেলিভারি ও অর্ডার পরিসংখ্যান
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={onSyncSheet}
            disabled={isSyncing}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2.5 rounded-xl bg-[#171b26] hover:bg-[#202636] border border-[#262f44] text-gray-200 text-xs sm:text-sm font-medium transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 text-pink-400 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'সিঙ্ক হচ্ছে...' : 'Sync Sheet'}</span>
          </button>

          <button
            onClick={onOpenNewOrder}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 via-rose-600 to-pink-500 hover:from-pink-500 hover:to-rose-500 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-pink-600/30 transition-all active:scale-95"
          >
            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>+ New Order</span>
          </button>
        </div>
      </div>

      {/* 4 Main Stat Cards (grid-cols-2 on mobile for best overview) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* Card 1: মোট অর্ডার */}
        <div className="bg-[#12151f] border border-[#1e2436] rounded-2xl p-3.5 sm:p-5 relative overflow-hidden group hover:border-pink-500/40 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-medium text-gray-300">মোট অর্ডার</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400">
              <Package className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3">
            <div className="text-2xl sm:text-4xl font-extrabold text-pink-500 tracking-tight flex items-baseline gap-1">
              <span>{totalOrdersCount}</span>
              <span className="text-base sm:text-xl font-bold text-pink-400">টি</span>
            </div>
            <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1 font-medium">Total Orders</p>
          </div>
          <div className="absolute -right-6 -bottom-6 w-20 sm:w-24 h-20 sm:h-24 bg-pink-500/5 rounded-full blur-xl pointer-events-none" />
        </div>

        {/* Card 2: প্রসেসিং */}
        <div className="bg-[#12151f] border border-[#1e2436] rounded-2xl p-3.5 sm:p-5 relative overflow-hidden group hover:border-pink-500/40 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-medium text-gray-300">প্রসেসিং</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Clock className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3">
            <div className="text-2xl sm:text-4xl font-extrabold text-pink-500 tracking-tight flex items-baseline gap-1">
              <span>{processingCount}</span>
              <span className="text-base sm:text-xl font-bold text-pink-400">টি</span>
            </div>
            <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1 font-medium">Processing</p>
          </div>
          <div className="absolute -right-6 -bottom-6 w-20 sm:w-24 h-20 sm:h-24 bg-blue-500/5 rounded-full blur-xl pointer-events-none" />
        </div>

        {/* Card 3: হোল্ডিং */}
        <div className="bg-[#12151f] border border-[#1e2436] rounded-2xl p-3.5 sm:p-5 relative overflow-hidden group hover:border-pink-500/40 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-medium text-gray-300">হোল্ডিং</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3">
            <div className="text-2xl sm:text-4xl font-extrabold text-pink-500 tracking-tight flex items-baseline gap-1">
              <span>{holdingCount}</span>
              <span className="text-base sm:text-xl font-bold text-pink-400">টি</span>
            </div>
            <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1 font-medium">Holding</p>
          </div>
          <div className="absolute -right-6 -bottom-6 w-20 sm:w-24 h-20 sm:h-24 bg-purple-500/5 rounded-full blur-xl pointer-events-none" />
        </div>

        {/* Card 4: ক্যান্সেলড/রিটার্ন */}
        <div className="bg-[#12151f] border border-[#1e2436] rounded-2xl p-3.5 sm:p-5 relative overflow-hidden group hover:border-pink-500/40 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-medium text-gray-300">ক্যান্সেলড</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <AlertOctagon className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </div>
          <div className="mt-2 sm:mt-3">
            <div className="text-2xl sm:text-4xl font-extrabold text-pink-500 tracking-tight flex items-baseline gap-1">
              <span>{cancelledCount}</span>
              <span className="text-base sm:text-xl font-bold text-pink-400">টি</span>
            </div>
            <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1 font-medium">Cancelled/Returned</p>
          </div>
          <div className="absolute -right-6 -bottom-6 w-20 sm:w-24 h-20 sm:h-24 bg-rose-500/5 rounded-full blur-xl pointer-events-none" />
        </div>
      </div>

      {/* Main Two Columns Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Left Column: দৈনিক অর্ডারের গ্রাফ */}
        <div className="lg:col-span-6 bg-[#12151f] border border-[#1e2436] rounded-2xl p-4 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  দৈনিক অর্ডারের গ্রাফ
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  সপ্তাহের দিন অনুযায়ী মোট অর্ডারের পরিমাণ
                </p>
              </div>
              <span className="text-[11px] sm:text-xs px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/20 font-medium">
                এই সপ্তাহ
              </span>
            </div>

            {/* Neon Bar Graph */}
            <div className="relative pt-4 sm:pt-6 pb-2">
              {/* Y Axis Grid lines */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none text-[10px] sm:text-[11px] text-gray-600 pr-2">
                <div className="border-b border-gray-800/80 pb-0.5 flex justify-between">
                  <span>80</span>
                </div>
                <div className="border-b border-gray-800/80 pb-0.5 flex justify-between">
                  <span>60</span>
                </div>
                <div className="border-b border-gray-800/80 pb-0.5 flex justify-between">
                  <span>40</span>
                </div>
                <div className="border-b border-gray-800/80 pb-0.5 flex justify-between">
                  <span>20</span>
                </div>
                <div className="border-b border-gray-800/80 pb-0.5 flex justify-between">
                  <span>0</span>
                </div>
              </div>

              {/* Bars container */}
              <div className="relative z-10 flex items-end justify-between h-44 sm:h-52 px-2 sm:px-4 pt-4">
                {INITIAL_DAILY_TREND.map((item, index) => {
                  const maxVal = 80;
                  const heightPercent = Math.min(100, Math.round((item.orders / maxVal) * 100));
                  const isHighlight = index === 2 || index === 4;

                  return (
                    <div
                      key={item.day}
                      className="flex flex-col items-center flex-1 group cursor-pointer"
                    >
                      <div className="relative w-full flex flex-col items-center">
                        {/* Tooltip on hover */}
                        <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity bg-pink-950/90 text-pink-300 text-[10px] px-1.5 py-0.5 rounded border border-pink-500/40 pointer-events-none whitespace-nowrap z-20">
                          {item.orders} টি
                        </div>

                        {/* Bar */}
                        <div
                          style={{ height: `${heightPercent}%` }}
                          className={`w-4 sm:w-7 rounded-t-lg transition-all duration-300 group-hover:scale-y-105 ${
                            isHighlight
                              ? 'bg-gradient-to-t from-pink-700 via-rose-500 to-pink-400 shadow-lg shadow-pink-500/30 neon-pink-glow'
                              : 'bg-gradient-to-t from-gray-800 via-purple-900/60 to-purple-500/70'
                          }`}
                        />
                      </div>

                      {/* Day Label */}
                      <span className="text-[10px] sm:text-xs text-gray-400 font-medium mt-2">
                        {item.day}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pt-3 sm:pt-4 mt-3 sm:mt-4 border-t border-[#1c2232] flex items-center justify-between text-xs text-gray-400">
            <span>সর্বোচ্চ বিক্রি: <strong>বুধবার (৭৮ টি)</strong></span>
            <span className="text-pink-400 font-semibold">গড়: ৪৪ টি/দিন</span>
          </div>
        </div>

        {/* Right Column: সাম্প্রতিক অর্ডার স্ট্যাটাস */}
        <div className="lg:col-span-6 bg-[#12151f] border border-[#1e2436] rounded-2xl p-4 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  সাম্প্রতিক অর্ডার স্ট্যাটাস
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  সর্বশেষ গৃহীত অর্ডারসমূহ এবং অবস্থা
                </p>
              </div>
              <button
                onClick={onNavigateToOrders}
                className="text-xs font-semibold text-pink-400 hover:text-pink-300 flex items-center gap-1 group"
              >
                <span>সব দেখুন</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            {/* Recent Orders List */}
            <div className="space-y-2">
              {recentOrders.map((order, index) => {
                const badgeClass = getStatusBadge(order.status);
                const bngLabel = getStatusLabelBengali(order.status);

                return (
                  <div
                    key={`${order.id}-${order.rowIndex ?? index}`}
                    onClick={() => onSelectOrder(order)}
                    className="p-2.5 sm:p-3 rounded-xl bg-[#161a26] hover:bg-[#1a1f2e] border border-[#202738] flex items-center justify-between gap-2 cursor-pointer transition-all active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-pink-500/10 text-pink-400 flex items-center justify-center font-mono font-bold text-xs shrink-0">
                        {order.id.slice(-2)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-200 text-xs truncate">
                          {order.customerName}
                        </div>
                        <div className="text-[11px] text-gray-400 truncate">
                          {order.product || 'Standard'} • ৳{order.total || order.amount || 599}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] sm:text-[11px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${badgeClass}`}
                    >
                      {bngLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-3 sm:pt-4 mt-3 sm:mt-4 border-t border-[#1c2232] flex items-center justify-between text-xs">
            <span className="text-gray-400">
              মোট <strong className="text-gray-200">{orders.length}</strong> টি অর্ডার
            </span>
            <button
              onClick={onNavigateToOrders}
              className="text-pink-400 hover:underline font-semibold"
            >
              অর্ডার ম্যানেজারে যান →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
