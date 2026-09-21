// Parses vless:// / vmess:// / trojan:// / ss:// / socks5:// share links (the
// common share-link formats used by v2rayN, Hiddify, NekoBox, etc.) into a
// sing-box outbound object.
//
// Exposes: window.V2RayParser.parseLink(link) -> { name, outbound }
// Throws Error with a human-readable message on malformed / unsupported links.

(function (global) {
  function parseLink(rawLink) {
    const link = rawLink.trim();
    if (link.startsWith('vless://')) return parseVless(link);
    if (link.startsWith('trojan://')) return parseTrojan(link);
    if (link.startsWith('vmess://')) return parseVmess(link);
    if (link.startsWith('ss://')) return parseShadowsocks(link);
    if (link.startsWith('socks5://') || link.startsWith('socks://')) return parseSocks(link);
    throw new Error('فقط لینک‌های vless/vmess/trojan/ss/socks5 پشتیبانی می‌شن');
  }

  function base64UrlDecodeUtf8(b64) {
    const normalized = b64.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
    const padded = normalized + '==='.slice((normalized.length + 3) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }

  function splitLink(link, scheme) {
    const withoutScheme = link.slice(scheme.length + 3); // "scheme://"
    const hashIdx = withoutScheme.indexOf('#');
    const remark = hashIdx >= 0 ? decodeURIComponent(withoutScheme.slice(hashIdx + 1)) : '';
    const body = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme;

    const atIdx = body.lastIndexOf('@');
    if (atIdx < 0) throw new Error('فرمت لینک نامعتبره (بخش @ پیدا نشد)');
    const userinfo = decodeURIComponent(body.slice(0, atIdx));
    const rest = body.slice(atIdx + 1);

    const qIdx = rest.indexOf('?');
    const hostPort = qIdx >= 0 ? rest.slice(0, qIdx) : rest;
    const query = new URLSearchParams(qIdx >= 0 ? rest.slice(qIdx + 1) : '');

    let host, port;
    if (hostPort.startsWith('[')) {
      // IPv6
      const closeIdx = hostPort.indexOf(']');
      host = hostPort.slice(1, closeIdx);
      port = hostPort.slice(closeIdx + 2);
    } else {
      const parts = hostPort.split(':');
      port = parts.pop();
      host = parts.join(':');
    }
    if (!host || !port) throw new Error('host یا port در لینک پیدا نشد');

    return { userinfo, host, port: parseInt(port, 10), query, remark };
  }

  function buildTransport(query) {
    const type = query.get('type') || 'tcp';
    if (type === 'ws') {
      const t = { type: 'ws', path: query.get('path') || '/' };
      const wsHost = query.get('host');
      if (wsHost) t.headers = { Host: wsHost };
      return t;
    }
    if (type === 'grpc') {
      return { type: 'grpc', service_name: query.get('serviceName') || query.get('path') || '' };
    }
    if (type === 'http' || type === 'h2') {
      return { type: 'http', path: query.get('path') || '/', host: query.get('host') ? [query.get('host')] : undefined };
    }
    // "tcp" / raw / unsupported -> no transport block (plain TCP)
    return null;
  }

  function buildTLS(query, defaultSNI) {
    const security = query.get('security') || 'none';
    if (security === 'none') return null;

    const tls = {
      enabled: true,
      server_name: query.get('sni') || defaultSNI || undefined,
      insecure: query.get('allowInsecure') === '1' || query.get('insecure') === '1',
    };

    const fp = query.get('fp');
    if (fp) tls.utls = { enabled: true, fingerprint: fp };

    if (security === 'reality') {
      tls.reality = {
        enabled: true,
        public_key: query.get('pbk') || '',
        short_id: query.get('sid') || '',
      };
    }
    return tls;
  }

  function parseVless(link) {
    const { userinfo: uuid, host, port, query, remark } = splitLink(link, 'vless');
    const outbound = {
      type: 'vless',
      tag: 'proxy',
      server: host,
      server_port: port,
      uuid: uuid,
    };
    const flow = query.get('flow');
    if (flow) outbound.flow = flow;

    const tls = buildTLS(query, host);
    if (tls) outbound.tls = tls;

    const transport = buildTransport(query);
    if (transport) outbound.transport = transport;

    return { name: remark || `${host}:${port}`, outbound };
  }

  function parseTrojan(link) {
    const { userinfo: password, host, port, query, remark } = splitLink(link, 'trojan');
    const outbound = {
      type: 'trojan',
      tag: 'proxy',
      server: host,
      server_port: port,
      password: password,
    };

    // Trojan is TLS-by-default; still respect explicit security=none for edge cases.
    const security = query.get('security') || 'tls';
    if (security !== 'none') {
      const tls = buildTLS(new URLSearchParams([...query.entries(), ['security', security]]), host);
      outbound.tls = tls || { enabled: true, server_name: host };
    }

    const transport = buildTransport(query);
    if (transport) outbound.transport = transport;

    return { name: remark || `${host}:${port}`, outbound };
  }

  // vmess:// links are, by far-and-away convention (v2rayN/Hiddify/NekoBox),
  // "vmess://" + base64(JSON), not a query-string URI like vless/trojan.
  function parseVmess(link) {
    const b64 = link.slice('vmess://'.length);
    let json;
    try {
      json = JSON.parse(base64UrlDecodeUtf8(b64));
    } catch (err) {
      throw new Error('لینک vmess نامعتبره یا فرمتش (base64 JSON) پشتیبانی نمی‌شه');
    }
    if (!json.add || !json.port || !json.id) {
      throw new Error('لینک vmess فیلدهای لازم (add/port/id) رو نداره');
    }

    const outbound = {
      type: 'vmess',
      tag: 'proxy',
      server: json.add,
      server_port: parseInt(json.port, 10),
      uuid: json.id,
      security: json.scy || 'auto',
      alter_id: parseInt(json.aid || '0', 10) || 0,
    };

    const tlsOn = json.tls === 'tls' || json.tls === '1' || json.tls === true;
    if (tlsOn) {
      const tls = { enabled: true, server_name: json.sni || json.host || json.add };
      if (json.fp) tls.utls = { enabled: true, fingerprint: json.fp };
      outbound.tls = tls;
    }

    const net = json.net || 'tcp';
    if (net === 'ws') {
      const t = { type: 'ws', path: json.path || '/' };
      if (json.host) t.headers = { Host: json.host };
      outbound.transport = t;
    } else if (net === 'grpc') {
      outbound.transport = { type: 'grpc', service_name: json.path || '' };
    } else if (net === 'h2') {
      outbound.transport = { type: 'http', path: json.path || '/', host: json.host ? [json.host] : undefined };
    }
    // "tcp" -> no transport block

    return { name: json.ps || `${json.add}:${json.port}`, outbound };
  }

  // Supports SIP002 (ss://base64(method:password)@host:port#remark) and the
  // older fully-base64 form (ss://base64(method:password@host:port)#remark).
  // Plugin params (obfs, v2ray-plugin, ...) aren't supported — sing-box would
  // need the matching plugin binary, which is out of scope here.
  function parseShadowsocks(link) {
    const withoutScheme = link.slice('ss://'.length);
    const hashIdx = withoutScheme.indexOf('#');
    const remark = hashIdx >= 0 ? decodeURIComponent(withoutScheme.slice(hashIdx + 1)) : '';
    let body = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme;

    const qIdx = body.indexOf('?');
    const hasPlugin = qIdx >= 0 && /plugin=/.test(body.slice(qIdx + 1));
    if (hasPlugin) {
      throw new Error('لینک‌های ss با plugin (مثل v2ray-plugin/obfs) فعلاً پشتیبانی نمی‌شن');
    }
    if (qIdx >= 0) body = body.slice(0, qIdx);

    let userInfoRaw, hostPort;
    const atIdx = body.lastIndexOf('@');
    if (atIdx >= 0) {
      // SIP002: base64(method:password)@host:port
      try {
        userInfoRaw = base64UrlDecodeUtf8(body.slice(0, atIdx));
      } catch (err) {
        userInfoRaw = decodeURIComponent(body.slice(0, atIdx));
      }
      hostPort = body.slice(atIdx + 1);
    } else {
      // legacy: base64(method:password@host:port) — the whole thing
      const decoded = base64UrlDecodeUtf8(body);
      const atIdx2 = decoded.lastIndexOf('@');
      if (atIdx2 < 0) throw new Error('فرمت لینک ss نامعتبره');
      userInfoRaw = decoded.slice(0, atIdx2);
      hostPort = decoded.slice(atIdx2 + 1);
    }

    const colonIdx = userInfoRaw.indexOf(':');
    if (colonIdx < 0) throw new Error('فرمت method:password تو لینک ss پیدا نشد');
    const method = userInfoRaw.slice(0, colonIdx);
    const password = userInfoRaw.slice(colonIdx + 1);

    const parts = hostPort.split(':');
    const port = parts.pop();
    const host = parts.join(':');
    if (!host || !port) throw new Error('host یا port در لینک ss پیدا نشد');

    const outbound = {
      type: 'shadowsocks',
      tag: 'proxy',
      server: host,
      server_port: parseInt(port, 10),
      method,
      password,
    };
    return { name: remark || `${host}:${port}`, outbound };
  }

  // socks5://[user:pass@]host:port#remark — auth is optional. sing-box uses
  // the same core for this, no extra binary needed.
  function parseSocks(link) {
    const scheme = link.startsWith('socks5://') ? 'socks5://' : 'socks://';
    const withoutScheme = link.slice(scheme.length);
    const hashIdx = withoutScheme.indexOf('#');
    const remark = hashIdx >= 0 ? decodeURIComponent(withoutScheme.slice(hashIdx + 1)) : '';
    const body = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme;

    let userinfo = '';
    let hostPort = body;
    const atIdx = body.lastIndexOf('@');
    if (atIdx >= 0) {
      userinfo = decodeURIComponent(body.slice(0, atIdx));
      hostPort = body.slice(atIdx + 1);
    }

    const parts = hostPort.split(':');
    const port = parts.pop();
    const host = parts.join(':');
    if (!host || !port) throw new Error('فرمت لینک socks نامعتبره (host/port پیدا نشد)');

    const outbound = {
      type: 'socks',
      tag: 'proxy',
      server: host,
      server_port: parseInt(port, 10),
      version: '5',
    };
    if (userinfo) {
      const colonIdx = userinfo.indexOf(':');
      if (colonIdx >= 0) {
        outbound.username = userinfo.slice(0, colonIdx);
        outbound.password = userinfo.slice(colonIdx + 1);
      } else {
        outbound.username = userinfo;
      }
    }
    return { name: remark || `${host}:${port}`, outbound };
  }

  // Parses multiple links pasted at once (one per line). Returns
  // { results: [...], errors: [{line, message}] } — never throws, so the
  // caller can import whatever parsed and report the rest.
  function parseBulk(rawText) {
    const results = [];
    const errors = [];
    rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('#'))
      .forEach((line) => {
        try {
          results.push(parseLink(line));
        } catch (err) {
          errors.push({ line, message: err.message });
        }
      });
    return { results, errors };
  }

  // Decodes a v2ray-style subscription payload: usually a base64 blob that
  // decodes to a newline-separated list of vless://trojan:// links. Some
  // subscriptions serve the plain list directly (no base64), so fall back
  // to treating the raw body as already-decoded.
  function decodeSubscriptionBody(body) {
    const trimmed = body.trim();
    if (trimmed.includes('://')) return trimmed; // already plain
    try {
      const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = atob(normalized.replace(/\s/g, ''));
      if (decoded.includes('://')) return decoded;
    } catch (e) {
      // not valid base64 — fall through
    }
    return trimmed; // last resort, let parseBulk report per-line errors
  }

  function parseSubscriptionBody(body) {
    return parseBulk(decodeSubscriptionBody(body));
  }

  global.V2RayParser = { parseLink, parseBulk, parseSubscriptionBody, decodeSubscriptionBody };
})(typeof window !== 'undefined' ? window : globalThis);
