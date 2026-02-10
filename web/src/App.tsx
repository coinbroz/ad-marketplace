import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Tabbar } from '@telegram-apps/telegram-ui';
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

  return (
    <div style={{ paddingBottom: 80 }}>
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

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100 }}>
        <Tabbar>
          <Tabbar.Item
            text="Marketplace"
            selected={getActiveTab() === 'marketplace'}
            onClick={() => navigate('/')}
          />
          <Tabbar.Item
            text="My Deals"
            selected={getActiveTab() === 'deals'}
            onClick={() => navigate('/deals')}
          />
          <Tabbar.Item
            text="Profile"
            selected={getActiveTab() === 'profile'}
            onClick={() => navigate('/profile')}
          />
        </Tabbar>
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
