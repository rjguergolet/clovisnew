import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  (window as any).toggleMobileMenuSheet = (window as any).toggleMobileMenuSheet || function(forceState?: boolean) {
    const sheet = document.getElementById("mobileMenuSheet");
    const backdrop = document.getElementById("mobileMenuSheetBackdrop");
    if (!sheet) return;

    const isClosed = sheet.classList.contains("translate-y-full") || sheet.classList.contains("hidden");
    const newState = forceState !== undefined ? Boolean(forceState) : isClosed;

    if (newState) {
      if (backdrop) backdrop.classList.remove("hidden");
      sheet.classList.remove("hidden");
      requestAnimationFrame(() => {
        sheet.classList.remove("translate-y-full");
      });
      document.body.classList.add("overflow-hidden");
    } else {
      sheet.classList.add("translate-y-full");
      if (backdrop) backdrop.classList.add("hidden");
      setTimeout(() => {
        if (sheet.classList.contains("translate-y-full")) {
          sheet.classList.add("hidden");
        }
      }, 300);
      document.body.classList.remove("overflow-hidden");
    }
  };
}

createRoot(document.getElementById('root')!).render(<App />);
