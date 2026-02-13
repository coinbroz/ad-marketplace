import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authenticate } from './api/client';
import { MarketplacePage } from './pages/Marketplace';
import { DealsPage } from './pages/Deals';
import { DealPage } from './pages/Deal';
import { ChannelPage } from './pages/Channel';
import { CampaignPage } from './pages/Campaign';
import { ProfilePage } from './pages/Profile';
import { PaymentPage } from './pages/Payment';
import { CreateCampaignPage } from './pages/CreateCampaign';
import type { User } from './types';

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);

  // Authenticate on mount
  const { isLoading, error } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const u = await authenticate();
      setUser(u);
      return u;
    },
    retry: 2,
  });

  // Determine active tab
  const getActiveTab = () => {
    if (location.pathname.startsWith('/deals')) return 'deals';
    if (location.pathname.startsWith('/profile')) return 'profile';
    return 'marketplace';
  };

  // Handle Telegram BackButton
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    const isSubPage = location.pathname.split('/').length > 2;

    if (isSubPage) {
      tg.BackButton?.show();
      const handler = () => navigate(-1);
      tg.BackButton?.onClick(handler);
      return () => tg.BackButton?.offClick(handler);
    } else {
      tg.BackButton?.hide();
    }
  }, [location.pathname, navigate]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <h3>Authentication Error</h3>
        <p>{error instanceof Error ? error.message : 'Failed to authenticate'}</p>
        <p>Please open this app from Telegram.</p>
      </div>
    );
  }

  const activeTab = getActiveTab();

  return (
    <div style={{ paddingBottom: 100 }}>
      <Routes>
        <Route path="/" element={<MarketplacePage user={user} />} />
        <Route path="/channels/:id" element={<ChannelPage user={user} />} />
        <Route path="/campaigns/create" element={<CreateCampaignPage user={user} />} />
        <Route path="/campaigns/:id" element={<CampaignPage user={user} />} />
        <Route path="/deals" element={<DealsPage user={user} />} />
        <Route path="/deals/:id" element={<DealPage user={user} />} />
        <Route path="/deals/:id/pay" element={<PaymentPage />} />
        <Route path="/profile" element={<ProfilePage user={user} />} />
      </Routes>

      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        background: 'var(--tg-theme-bg-color, #fff)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        borderTop: '1px solid var(--tg-theme-hint-color, #ddd)',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          padding: '8px 0',
        }}>
          {[
            { key: 'marketplace', label: 'Marketplace', path: '/' },
            { key: 'deals', label: 'My Deals', path: '/deals' },
            { key: 'profile', label: 'Profile', path: '/profile' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => navigate(tab.path)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: '6px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: activeTab === tab.key
                  ? 'var(--tg-theme-button-color, #3390ec)'
                  : 'var(--tg-theme-hint-color, #999)',
                fontWeight: activeTab === tab.key ? 700 : 500,
                fontSize: 13,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {tab.key === 'marketplace' ? (
                  // Storefront icon
                  <>
                    <path d="M3 9l1.5-5h15L21 9" />
                    <path d="M3 9h18v1a3 3 0 01-3 3 3 3 0 01-3-3 3 3 0 01-3 3 3 3 0 01-3-3 3 3 0 01-3 3 3 3 0 01-3-3V9z" />
                    <path d="M5 13v7a1 1 0 001 1h12a1 1 0 001-1v-7" />
                    <path d="M10 21v-6h4v6" />
                  </>
                ) : tab.key === 'deals' ? (
                  // Document with checkmark icon
                  <>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <path d="M9 15l2 2 4-4" />
                  </>
                ) : (
                  // Person icon
                  <>
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </>
                )}
              </svg>
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
