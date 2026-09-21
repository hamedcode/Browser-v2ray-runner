(function (global) {
  global.V2RayConstants = {
    LOCAL_PROXY_PORT: 2080,
    CLASH_API_PORT: 9090,
    CLASH_API_SECRET: 'browserv2ray-local',
    TEST_PROXY_PORT: 12081, // base port — concurrent test slots use PORT+slotIndex
    TEST_CONCURRENCY: 10,
    LATENCY_TEST_URL: 'https://www.gstatic.com/generate_204',
    ACCENT_COLORS: {
      blue: '#4c8dff',
      green: '#35c759',
      purple: '#8b5cf6',
      orange: '#f5943a',
      pink: '#ec4899',
      teal: '#14b8a6',
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
