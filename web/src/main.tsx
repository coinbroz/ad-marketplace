import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { AppRoot } from '@telegram-apps/telegram-ui';
import '@telegram-apps/telegram-ui/dist/styles.css';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const manifestUrl = `${window.location.origin}/tonconnect-manifest.json`;

// Telegram WebApp initialization
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// Fix: scroll focused input into view when mobile keyboard opens (Telegram WebView)
{
  const isInputLike = (el: Element | null): el is HTMLElement =>
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

  // Method 1: on focusin, scroll with multiple fallbacks
  document.addEventListener('focusin', (e) => {
    const target = e.target as HTMLElement;
    if (!isInputLike(target)) return;

    // Add bottom padding so there's room to scroll to bottom fields
    document.body.style.paddingBottom = '50vh';

    // Try multiple scroll methods with increasing delays (keyboard animation varies)
    for (const delay of [100, 300, 500]) {
      setTimeout(() => {
        if (document.activeElement !== target) return;
        const rect = target.getBoundingClientRect();
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        // If the input is in the bottom half or hidden, scroll it to center
        if (rect.bottom > viewportHeight * 0.6 || rect.top < 0) {
          const scrollTop = window.scrollY + rect.top - viewportHeight * 0.35;
          window.scrollTo({ top: scrollTop, behavior: 'smooth' });
        }
      }, delay);
    }
  });

  // Remove extra padding when keyboard closes
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!isInputLike(document.activeElement)) {
        document.body.style.paddingBottom = '';
      }
    }, 100);
  });

  // Method 2: visualViewport resize (fires when keyboard opens/closes)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const focused = document.activeElement as HTMLElement;
      if (!isInputLike(focused)) return;
      setTimeout(() => {
        const rect = focused.getBoundingClientRect();
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        if (rect.bottom > viewportHeight * 0.7 || rect.top < 0) {
          const scrollTop = window.scrollY + rect.top - viewportHeight * 0.35;
          window.scrollTo({ top: scrollTop, behavior: 'smooth' });
        }
      }, 50);
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <QueryClientProvider client={queryClient}>
        <AppRoot>
          <App />
        </AppRoot>
      </QueryClientProvider>
    </TonConnectUIProvider>
  </React.StrictMode>,
);
