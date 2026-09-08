import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import {
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Menu,
  LayoutDashboard,
  ShoppingBag,
  BarChart3,
  Plus,
} from 'lucide-react';
import { Order, OrderStatus, Product, CartItem } from './types';
import { INITIAL_ORDERS } from './data/initialOrders';
import {
  initAuth,
  googleSignIn,
  logout,
  setAccessToken,
  AuthDomainError,
} from './services/auth';
import {
  DEFAULT_SPREADSHEET_ID,
  extractSpreadsheetId,
  getSheetOrders,
  updateSheetOrderStatus,
  updateSheetVariant,
  updateSheetSource,
  updateSheetCourierStatus,
  updateSheetSteadfastAction,
  updateSheetQuantity,
  appendSheetOrder,
  getSheetProducts,
} from './services/sheets';
import { Sidebar, MainTabType } from './components/Sidebar';
import { DashboardHome } from './components/DashboardHome';
import { OrdersView } from './components/OrdersView';
import { ReportsView } from './components/ReportsView';
import { NewOrderModal } from './components/NewOrderModal';
import { ViewOrderModal } from './components/ViewOrderModal';
import { SheetSettingsModal } from './components/SheetSettingsModal';
import { AuthHelpModal } from './components/AuthHelpModal';

export default function App() {
  // Authentication state
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // Active navigation tab (Customers & Storefront removed)
  const [activeTab, setActiveTab] = useState<MainTabType>('home');

  // Mobile menu open state
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Orders and Products data
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [orderSheetTab, setOrderSheetTab] = useState<string>(() => {
    return localStorage.getItem('order_sheet_tab') || 'Sheet2';
  });

  // Spreadsheet ID
  const [spreadsheetId, setSpreadsheetId] = useState<string>(DEFAULT_SPREADSHEET_ID);

  // Syncing & Loading
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals state
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const [selectedOrderForView, setSelectedOrderForView] = useState<Order | null>(null);
  const [isSheetSettingsOpen, setIsSheetSettingsOpen] = useState(false);
  const [isAuthHelpOpen, setIsAuthHelpOpen] = useState(false);
  const [authErrorDomain, setAuthErrorDomain] = useState('');

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4500);
  };

  // 1. Initialize Firebase Auth
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, token) => {
        setUser(currentUser);
        setToken(token);
        setAccessToken(token);
        if (token) {
          syncWithSheet(spreadsheetId, token, orderSheetTab);
        }
      },
      () => {
        setUser(null);
        setToken(null);
        setAccessToken(null);
        // Automatically fetch public live orders if not logged in
        syncWithSheet(spreadsheetId, null, orderSheetTab);
      }
    );
    return () => unsubscribe();
  }, [spreadsheetId, orderSheetTab]);

  // 2. Sync orders with Google Sheet
  const syncWithSheet = async (
    targetSpreadsheetId: string = spreadsheetId,
    targetToken: string | null = accessToken,
    targetTab: string = orderSheetTab,
    silent: boolean = false
  ) => {
    if (!silent) setIsSyncing(true);
    try {
      const cleanId = extractSpreadsheetId(targetSpreadsheetId);
      const sheetResult = await getSheetOrders(cleanId, targetToken || undefined, targetTab);

      if (sheetResult.orders && sheetResult.orders.length > 0) {
        setOrders(sheetResult.orders);
        if (!silent) {
          showToast(
            `গুগল শিট (${targetTab}) থেকে ${sheetResult.orders.length} টি অর্ডার সফলভাবে সিঙ্ক হয়েছে!`
          );
        }
      } else if (!silent) {
        showToast(`শিট (${targetTab}) থেকে কোনো অর্ডার পাওয়া যায়নি।`, 'error');
      }
    } catch (err: any) {
      console.warn('Sync sheet error:', err);
      if (!silent) {
        if (err instanceof AuthDomainError) {
          setAuthErrorDomain(err.domain);
          setIsAuthHelpOpen(true);
        } else {
          showToast(`শিট সিঙ্ক তথ্য: ${err.message || 'ত্রুটি'}`, 'error');
        }
      }
    } finally {
      if (!silent) setIsSyncing(false);
    }
  };

  // Google Login Handler
  const handleGoogleSignIn = async () => {
    setIsAuthLoading(true);
    try {
      const result = await googleSignIn();
      setUser(result.user);
      setToken(result.accessToken);
      setAccessToken(result.accessToken);
      showToast(`স্বাগতম, ${result.user.displayName || 'অ্যাডমিন'}! গুগল সাইন-ইন সফল।`);
      await syncWithSheet(spreadsheetId, result.accessToken);
    } catch (err: any) {
      console.error('Login error:', err);
      if (err instanceof AuthDomainError) {
        setAuthErrorDomain(err.domain);
        setIsAuthHelpOpen(true);
      } else {
        showToast(`সাইন ইন ত্রুটি: ${err.message}`, 'error');
      }
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Logout Handler
  const handleLogout = async () => {
    await logout();
    setUser(null);
    setToken(null);
    setAccessToken(null);
    showToast('সফলভাবে লগআউট করা হয়েছে।');
  };

  // Helper to isolate orders without collision
  const isSameOrder = (a: Order, b: Order) => {
    if (a.rowIndex !== undefined && a.rowIndex !== null && b.rowIndex !== undefined && b.rowIndex !== null) {
      return a.rowIndex === b.rowIndex;
    }
    return a.id === b.id;
  };

  // Helper to ensure valid sheet row index (>= 2, never 0)
  const resolveRowIndex = (order: Order): number => {
    if (order.rowIndex && order.rowIndex > 1) {
      return order.rowIndex;
    }
    const idx = orders.findIndex((o) => o.id === order.id);
    return idx !== -1 ? idx + 2 : 2;
  };

  // 1. Update Status in Column J (isolated per-order)
  const handleUpdateOrderStatus = async (order: Order, newStatus: OrderStatus) => {
    const targetRow = resolveRowIndex(order);
    setOrders((prev) =>
      prev.map((o) => (isSameOrder(o, order) ? { ...o, status: newStatus, rowIndex: targetRow } : o))
    );

    if (selectedOrderForView && isSameOrder(selectedOrderForView, order)) {
      setSelectedOrderForView((prev) => (prev ? { ...prev, status: newStatus, rowIndex: targetRow } : null));
    }

    try {
      await updateSheetOrderStatus(
        spreadsheetId,
        accessToken,
        orderSheetTab,
        targetRow,
        newStatus,
        order.id
      );
      showToast(`✅ গুগল শিটে অর্ডার #${order.id} এর স্ট্যাটাস (Col J) '${newStatus}' আপডেট হয়েছে!`);
    } catch (err: any) {
      console.error('Failed to sync status update to sheet:', err);
      showToast(`❌ গুগল শিটে স্ট্যাটাস সেভ ব্যর্থ: ${err.message || 'ত্রুটি'}`, 'error');
    }
  };

  // 2. Update Variant in Column H (isolated per-order)
  const handleUpdateVariant = async (order: Order, newVariant: string) => {
    const targetRow = resolveRowIndex(order);
    setOrders((prev) =>
      prev.map((o) => (isSameOrder(o, order) ? { ...o, variant: newVariant, rowIndex: targetRow } : o))
    );

    if (selectedOrderForView && isSameOrder(selectedOrderForView, order)) {
      setSelectedOrderForView((prev) => (prev ? { ...prev, variant: newVariant, rowIndex: targetRow } : null));
    }

    try {
      await updateSheetVariant(
        spreadsheetId,
        accessToken,
        orderSheetTab,
        targetRow,
        newVariant,
        order.id
      );
      showToast(`✅ গুগল শিটে অর্ডার #${order.id} এর ভ্যারিয়েন্ট (Col H) '${newVariant}' আপডেট হয়েছে!`);
    } catch (err: any) {
      console.error('Failed to sync variant update to sheet:', err);
      showToast(`❌ গুগল শিটে ভ্যারিয়েন্ট সেভ ব্যর্থ: ${err.message || 'ত্রুটি'}`, 'error');
    }
  };

  // 3. Update Source in Column I (isolated per-order)
  const handleUpdateSource = async (order: Order, newSource: string) => {
    const targetRow = resolveRowIndex(order);
    setOrders((prev) =>
      prev.map((o) => (isSameOrder(o, order) ? { ...o, source: newSource, rowIndex: targetRow } : o))
    );

    if (selectedOrderForView && isSameOrder(selectedOrderForView, order)) {
      setSelectedOrderForView((prev) => (prev ? { ...prev, source: newSource, rowIndex: targetRow } : null));
    }

    try {
      await updateSheetSource(
        spreadsheetId,
        accessToken,
        orderSheetTab,
        targetRow,
        newSource,
        order.id
      );
      showToast(`✅ গুগল শিটে অর্ডার #${order.id} এর সোর্স (Col I) '${newSource}' আপডেট হয়েছে!`);
    } catch (err: any) {
      console.error('Failed to sync source update to sheet:', err);
      showToast(`❌ গুগল শিটে সোর্স সেভ ব্যর্থ: ${err.message || 'ত্রুটি'}`, 'error');
    }
  };

  // Update Delivery / Courier Status in Column L
  const handleUpdateCourierStatus = async (order: Order, newCourierStatus: string) => {
    setOrders((prev) =>
      prev.map((o) => (isSameOrder(o, order) ? { ...o, courierStatus: newCourierStatus } : o))
    );

    if (selectedOrderForView && isSameOrder(selectedOrderForView, order)) {
      setSelectedOrderForView((prev) => (prev ? { ...prev, courierStatus: newCourierStatus } : null));
    }

    try {
      await updateSheetCourierStatus(
        spreadsheetId,
        accessToken,
        orderSheetTab,
        order.rowIndex || 0,
        order.trackingCode || '',
        order.steadfastStatus || 'send to steadfast',
        newCourierStatus,
        order.id
      );
      showToast(`✅ গুগল শিটে ডেলিভারি স্ট্যাটাস '${newCourierStatus}' আপডেট হয়েছে!`);
    } catch (err: any) {
      console.error('Failed to sync courier status update to sheet:', err);
      showToast(`❌ গুগল শিটে ডেলিভারি স্ট্যাটাস সেভ ব্যর্থ: ${err.message || 'ত্রুটি'}`, 'error');
    }
  };

  // Delete Order Handler
  const handleDeleteOrder = (orderToDelete: Order) => {
    setOrders((prev) => prev.filter((o) => !isSameOrder(o, orderToDelete)));
    showToast(`অর্ডার #${orderToDelete.id} সফলভাবে ডিলিট করা হয়েছে!`);
    if (selectedOrderForView && isSameOrder(selectedOrderForView, orderToDelete)) {
      setSelectedOrderForView(null);
    }
  };

  // 4. Steadfast Courier Action (Toggle in Column M only)
  // "send to steadfast dila k and l a automatic j data ashbe seta sodo read kore nicer 2ta button a update korbe, r kisoi jeno change na korta hoy"
  const handleToggleSteadfast = async (
    order: Order,
    action: 'No Sellect' | 'send to steadfast'
  ): Promise<boolean> => {
    const targetRow = resolveRowIndex(order);

    if (action === 'No Sellect') {
      setOrders((prev) =>
        prev.map((o) =>
          isSameOrder(o, order)
            ? {
                ...o,
                steadfastStatus: 'No Sellect',
                rowIndex: targetRow,
              }
            : o
        )
      );

      if (selectedOrderForView && isSameOrder(selectedOrderForView, order)) {
        setSelectedOrderForView((prev) =>
          prev ? { ...prev, steadfastStatus: 'No Sellect', rowIndex: targetRow } : null
        );
      }

      try {
        await updateSheetSteadfastAction(
          spreadsheetId,
          accessToken,
          orderSheetTab,
          targetRow,
          'No Sellect',
          order.id
        );
        showToast(`✅ গুগল শিটে (কলাম M) 'No Sellect' আপডেট হয়েছে!`);
      } catch (err: any) {
        console.error('Failed to sync No Sellect to sheet:', err);
        showToast(`❌ গুগল শিটে আপডেট ব্যর্থ: ${err.message || 'ত্রুটি'}`, 'error');
      }
      return true;
    }

    // Action: "send to steadfast"
    const cleanPhone = (order.customerPhone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone || cleanPhone.length < 11) {
      showToast(
        `⚠️ ফোন নম্বর ভুল বা অসম্পূর্ণ (${order.customerPhone || 'খালি'})! বুকিংয়ের জন্য ১১ ডিজিটের সঠিক মোবাইল নম্বর প্রয়োজন।`,
        'error'
      );
      return false;
    }

    // Update ONLY Column M (steadfastStatus) - do NOT overwrite K (Tracking) or L (Courier Status)
    const finalSteadfastStatus = 'send to steadfast';

    setOrders((prev) =>
      prev.map((o) =>
        isSameOrder(o, order)
          ? {
              ...o,
              steadfastStatus: finalSteadfastStatus,
              rowIndex: targetRow,
            }
          : o
      )
    );

    if (selectedOrderForView && isSameOrder(selectedOrderForView, order)) {
      setSelectedOrderForView((prev) =>
        prev
          ? {
              ...prev,
              steadfastStatus: finalSteadfastStatus,
              rowIndex: targetRow,
            }
          : null
      );
    }

    try {
      // Write strictly to Column M
      await updateSheetSteadfastAction(
        spreadsheetId,
        accessToken,
        orderSheetTab,
        targetRow,
        finalSteadfastStatus,
        order.id
      );
      showToast(`✅ কলাম M: 'send to steadfast' আপডেট হয়েছে! অটোমেশন কলাম K ও L রিড করা হচ্ছে...`);

      // Automatically read fresh Column K and L from Google Sheet automation after delay
      setTimeout(() => {
        syncWithSheet(spreadsheetId, accessToken, orderSheetTab, true);
      }, 2500);

      setTimeout(() => {
        syncWithSheet(spreadsheetId, accessToken, orderSheetTab, true);
      }, 5500);
    } catch (err: any) {
      console.error('Failed to sync steadfast action to sheet:', err);
      showToast(`❌ গুগল শিটে কলাম M সেভ ব্যর্থ: ${err.message || 'ত্রুটি'}`, 'error');
    }

    return true;
  };

  // 5. Update Order Quantity in Column N (isolated per-order)
  const handleUpdateQuantity = async (order: Order, newQuantity: number) => {
    if (newQuantity < 1) return;
    const targetRow = resolveRowIndex(order);
    setOrders((prev) =>
      prev.map((o) => (isSameOrder(o, order) ? { ...o, quantity: newQuantity, rowIndex: targetRow } : o))
    );

    if (selectedOrderForView && isSameOrder(selectedOrderForView, order)) {
      setSelectedOrderForView((prev) => (prev ? { ...prev, quantity: newQuantity, rowIndex: targetRow } : null));
    }

    try {
      await updateSheetQuantity(
        spreadsheetId,
        accessToken,
        orderSheetTab,
        targetRow,
        newQuantity,
        order.id
      );
      showToast(`✅ গুগল শিটে অর্ডার #${order.id} এর পরিমাণ (Col N) '${newQuantity}' আপডেট হয়েছে!`);
    } catch (err: any) {
      console.error('Failed to sync quantity update to sheet:', err);
      showToast(`❌ গুগল শিটে পরিমাণ সেভ ব্যর্থ: ${err.message || 'ত্রুটি'}`, 'error');
    }
  };

  // Alias for components expecting handleSendToSteadfast
  const handleSendToSteadfast = (order: Order) => handleToggleSteadfast(order, 'send to steadfast');

  // Create New Order
  const handleAddNewOrder = async (newOrder: Order) => {
    setIsSubmittingOrder(true);
    try {
      // 1. Update local state
      const orderWithRow: Order = {
        ...newOrder,
        rowIndex: orders.length + 3,
      };
      setOrders((prev) => [orderWithRow, ...prev]);

      showToast(`নতুন অর্ডার ${newOrder.id} সফলভাবে তৈরি হয়েছে!`);

      // 2. Append to Google Sheet if token exists
      if (accessToken) {
        await appendSheetOrder(spreadsheetId, accessToken, newOrder, orderSheetTab);
        showToast('অর্ডারটি সরাসরি গুগল শিটে যুক্ত করা হয়েছে!');
      }
    } catch (err: any) {
      console.error('Error creating new order:', err);
      showToast(`শিটে অর্ডার যোগ করতে সমস্যা: ${err.message}`, 'error');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#0a0c13] text-gray-100 font-sans overflow-hidden">
      {/* Sidebar Navigation (Desktop + Mobile Drawer) */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={(tab) => {
          if (tab === 'sheet') {
            setIsSheetSettingsOpen(true);
          } else {
            setActiveTab(tab);
          }
        }}
        user={user}
        onOpenSettings={() => setIsSheetSettingsOpen(true)}
        onLogout={handleLogout}
        ordersCount={orders.length}
        mobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-[#0c0e16]">
        {/* Mobile Top Header (hidden on md:) */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-[#0f121a] border-b border-[#1c2230] sticky top-0 z-30">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 rounded-xl text-gray-300 hover:text-white hover:bg-[#181c28] transition-colors border border-[#232a3d] active:scale-95"
              title="মেনু খুলুন"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-pink-600 to-rose-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-pink-600/30">
                ম
              </div>
              <div>
                <span className="font-bold text-sm text-white tracking-tight flex items-center gap-1">
                  মাই ব্যবসা <span className="text-[10px] px-1 py-0.2 rounded bg-pink-500/20 text-pink-400">PRO</span>
                </span>
                <p className="text-[10px] text-gray-400">ড্যাশবোর্ড</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => syncWithSheet()}
              disabled={isSyncing}
              className="p-2 rounded-xl text-pink-400 bg-pink-500/10 border border-pink-500/20 active:scale-95 transition-all"
              title="শিট সিঙ্ক"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={() => setIsSheetSettingsOpen(true)}
              className="w-8 h-8 rounded-full bg-gradient-to-tr from-pink-600 to-purple-600 text-white flex items-center justify-center font-bold text-xs shadow"
              title="সেটিংস"
            >
              {user?.displayName ? user.displayName.charAt(0) : 'A'}
            </button>
          </div>
        </div>

        {/* Top Info Bar for Google Sheet connection notification */}
        {!user && (
          <div className="bg-gradient-to-r from-pink-950/40 via-purple-950/40 to-pink-950/40 border-b border-pink-500/20 px-4 sm:px-6 py-2 flex items-center justify-between text-xs text-pink-300">
            <div className="flex items-center gap-2 truncate">
              <FileSpreadsheet className="w-4 h-4 text-pink-400 shrink-0" />
              <span className="truncate">
                ডেমো মোড। গুগল শিটের সাথে লাইভ সিঙ্ক করতে সাইন-ইন করুন।
              </span>
            </div>
            <button
              onClick={() => setIsSheetSettingsOpen(true)}
              className="font-bold underline hover:text-white shrink-0 ml-3 text-xs"
            >
              কানেক্ট →
            </button>
          </div>
        )}

        {/* View Switcher (pb-24 on mobile to give room for bottom nav) */}
        <div className="p-3 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-24 md:pb-12">
          {activeTab === 'home' && (
            <DashboardHome
              orders={orders}
              onNavigateToOrders={() => setActiveTab('orders')}
              onOpenNewOrder={() => setIsNewOrderOpen(true)}
              onSyncSheet={() => syncWithSheet()}
              isSyncing={isSyncing}
              onSelectOrder={(order) => setSelectedOrderForView(order)}
              onUpdateOrderStatus={handleUpdateOrderStatus}
            />
          )}

          {activeTab === 'orders' && (
            <OrdersView
              orders={orders}
              onOpenNewOrder={() => setIsNewOrderOpen(true)}
              onSyncSheet={() => syncWithSheet()}
              isSyncing={isSyncing}
              onSelectOrder={(order) => setSelectedOrderForView(order)}
              onUpdateOrderStatus={handleUpdateOrderStatus}
              onUpdateVariant={handleUpdateVariant}
              onUpdateSource={handleUpdateSource}
              onUpdateQuantity={handleUpdateQuantity}
              onUpdateCourierStatus={handleUpdateCourierStatus}
              onToggleSteadfast={handleToggleSteadfast}
              onDeleteOrder={handleDeleteOrder}
            />
          )}

          {activeTab === 'reports' && <ReportsView />}
        </div>
      </main>

      {/* Floating Action Button (+) on Bottom Right (Hovering above bottom nav, matching screenshot) */}
      <button
        onClick={() => setIsNewOrderOpen(true)}
        className="fixed bottom-20 right-5 z-40 w-14 h-14 rounded-full bg-[#8a4af3] hover:bg-[#9d66f7] text-white flex items-center justify-center shadow-2xl shadow-purple-950/80 active:scale-90 transition-transform"
        title="নতুন অর্ডার তৈরি করুন"
      >
        <Plus className="w-7 h-7 text-white stroke-[2.5]" />
      </button>

      {/* WooCommerce Style Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#141418] border-t border-[#26262d] px-6 py-2 flex items-center justify-between shadow-2xl">
        {/* Tab 1: Stats / Analytics */}
        <button
          onClick={() => setActiveTab('reports')}
          className={`flex flex-col items-center gap-1 transition-all ${
            activeTab === 'reports' ? 'text-purple-400 font-semibold' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <BarChart3 className="w-5 h-5" />
          <span className="text-[11px]">Analytics</span>
        </button>

        {/* Tab 2: Orders (With purple badge matching screenshot) */}
        <button
          onClick={() => setActiveTab('orders')}
          className={`flex flex-col items-center gap-1 relative transition-all ${
            activeTab === 'orders' ? 'text-purple-400 font-semibold' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <div className="relative">
            <ShoppingBag className="w-5 h-5" />
            <span className="absolute -top-1.5 -right-3 px-1.5 py-0.2 rounded-full bg-[#8a4af3] text-white text-[9px] font-bold shadow">
              {orders.length > 0 ? orders.length : '16'}
            </span>
          </div>
          <span className="text-[11px]">Orders</span>
        </button>

        {/* Tab 3: Google Sheet Sync / Products */}
        <button
          onClick={() => setIsSheetSettingsOpen(true)}
          className="flex flex-col items-center gap-1 text-gray-400 hover:text-gray-200 transition-all"
        >
          <FileSpreadsheet className="w-5 h-5" />
          <span className="text-[11px]">Sheet</span>
        </button>

        {/* Tab 4: Dashboard Home / More */}
        <button
          onClick={() => setActiveTab('home')}
          className={`flex flex-col items-center gap-1 transition-all ${
            activeTab === 'home' ? 'text-purple-400 font-semibold' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[11px]">Dashboard</span>
        </button>
      </nav>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-2xl border text-xs font-semibold backdrop-blur-md animate-fadeIn ${
            toastMessage.type === 'error'
              ? 'bg-rose-950/90 text-rose-200 border-rose-600/40 shadow-rose-950/50'
              : 'bg-pink-950/90 text-pink-200 border-pink-500/40 shadow-pink-950/50'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-pink-400 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* New Order Modal */}
      <NewOrderModal
        isOpen={isNewOrderOpen}
        onClose={() => setIsNewOrderOpen(false)}
        onSubmit={handleAddNewOrder}
        isSubmitting={isSubmittingOrder}
      />

      {/* View & Edit Order Modal */}
      <ViewOrderModal
        order={selectedOrderForView}
        onClose={() => setSelectedOrderForView(null)}
        onUpdateStatus={handleUpdateOrderStatus}
        onSendToSteadfast={handleSendToSteadfast}
        onDeleteOrder={handleDeleteOrder}
      />

      {/* Google Sheet Settings Modal */}
      <SheetSettingsModal
        isOpen={isSheetSettingsOpen}
        onClose={() => setIsSheetSettingsOpen(false)}
        spreadsheetId={spreadsheetId}
        onUpdateSpreadsheetId={(id) => {
          const cleanId = extractSpreadsheetId(id);
          setSpreadsheetId(cleanId);
          showToast(`গুগল শিট আইডি আপডেট করা হয়েছে: ${cleanId.slice(0, 12)}...`);
          syncWithSheet(cleanId, accessToken, orderSheetTab);
        }}
        selectedTab={orderSheetTab}
        onUpdateSelectedTab={(newTab) => {
          setOrderSheetTab(newTab);
          localStorage.setItem('order_sheet_tab', newTab);
          showToast(`শিট ট্যাব '${newTab}' সেট করা হয়েছে! সিঙ্ক হচ্ছে...`);
          syncWithSheet(spreadsheetId, accessToken, newTab);
        }}
        user={user}
        onSignIn={handleGoogleSignIn}
        onSignOut={handleLogout}
        isAuthLoading={isAuthLoading}
        onSyncNow={() => syncWithSheet(spreadsheetId, accessToken, orderSheetTab)}
        isSyncing={isSyncing}
        onOpenAuthHelp={() => {
          setAuthErrorDomain(typeof window !== 'undefined' ? window.location.hostname : '');
          setIsAuthHelpOpen(true);
        }}
      />

      {/* Google Sign-in Help & Domain Modal */}
      <AuthHelpModal
        isOpen={isAuthHelpOpen}
        onClose={() => setIsAuthHelpOpen(false)}
        domain={authErrorDomain || (typeof window !== 'undefined' ? window.location.hostname : '')}
        onUsePublicMode={() => {
          syncWithSheet(spreadsheetId, null);
          showToast('পাবলিক শিট মোডে লাইভ ডাটা সিঙ্ক হচ্ছে...');
        }}
        onSaveManualToken={(token) => {
          setToken(token);
          setAccessToken(token);
          syncWithSheet(spreadsheetId, token);
          showToast('ম্যানুয়াল টোকেন সংরক্ষণ করা হয়েছে এবং শিট সিঙ্ক হচ্ছে!');
        }}
      />
    </div>
  );
}
