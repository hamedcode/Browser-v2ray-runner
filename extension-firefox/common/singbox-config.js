// Wraps a parsed outbound into a full sing-box config: a local mixed
// (SOCKS+HTTP) inbound that the browser points chrome.proxy / browser.proxy
// at, routed through the user's proxy outbound. Also exposes a Clash-API
// compatible controller so the extension can poll traffic stats.

(function (global) {
  const C = global.V2RayConstants;

  function buildConfig(outbound) {
    return {
      log: { level: 'warn' },
      experimental: {
        clash_api: {
          external_controller: `127.0.0.1:${C.CLASH_API_PORT}`,
          secret: C.CLASH_API_SECRET,
        },
      },
      inbounds: [
        {
          type: 'mixed',
          tag: 'browser-in',
          listen: '127.0.0.1',
          listen_port: C.LOCAL_PROXY_PORT,
        },
      ],
      outbounds: [outbound, { type: 'direct', tag: 'direct' }],
      route: {
        final: outbound.tag,
      },
    };
  }

  // A throwaway config on a separate port, used only for the "test config"
  // latency check — never touches the browser's real proxy setting. Accepts
  // an explicit port so multiple tests can run concurrently without clashing.
  function buildTestConfig(outbound, port) {
    return {
      log: { level: 'error' },
      inbounds: [
        {
          type: 'mixed',
          tag: 'test-in',
          listen: '127.0.0.1',
          listen_port: port || C.TEST_PROXY_PORT,
        },
      ],
      outbounds: [outbound, { type: 'direct', tag: 'direct' }],
      route: {
        final: outbound.tag,
      },
    };
  }

  global.V2RaySingbox = { buildConfig, buildTestConfig, LOCAL_PROXY_PORT: C.LOCAL_PROXY_PORT };
})(typeof window !== 'undefined' ? window : globalThis);
