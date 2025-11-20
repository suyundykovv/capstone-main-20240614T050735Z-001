(() => {
  if (window.__tailwindDevLoader) {
    return;
  }
  window.__tailwindDevLoader = true;

  const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '', '0.0.0.0']);
  const isDevHost = DEV_HOSTS.has(window.location.hostname);
  if (!isDevHost) {
    return;
  }

  const config = window.__tailwindConfig || {};
  window.tailwind = window.tailwind || {};
  window.tailwind.config = config;

  const script = document.createElement('script');
  script.src = 'https://cdn.tailwindcss.com?plugins=forms,typography';
  script.referrerPolicy = 'no-referrer';
  script.crossOrigin = 'anonymous';
  script.dataset.tailwindDev = 'true';
  script.addEventListener('error', () => console.error('[Tailwind] CDN failed to load.'));
  document.head.appendChild(script);
})();
