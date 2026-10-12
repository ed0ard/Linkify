// Copyright (c) 2026 ed0ard. All rights reserved.
(function () {
  'use strict';

  const BTN_CLASS = 'buff-extract-inspect-link';
  const BTN_LABEL = '提取链接';
  const CACHE = new Map();

  const SITE = (() => {
    const host = location.hostname;
    if (host === 'buff.163.com') {
      return {
        id: 'buff',
        buyBtn: 'a.btn-buy-order, .btn-buy-order',
        groups: '.buff-extract-buy-stack',
        toastOk: '已复制',
        title: '复制游戏中检视链接',
      };
    }
    if (host === 'www.youpin898.com') {
      return {
        id: 'youpin',
        inspectBtn: [
          '[class*="operate-btn___"]',
          '[class*="commodity-inspect___"]',
          '[class*="controls___"] > *',
          '[class*="action-btns-open___"]',
          '[class*="action-btns-share___"]',
        ].join(', '),
        groups: [
          '[class*="controls___"]',
          '[class*="commodity-inspect___"]',
          '[class*="action-btns"]',
          '[class*="popBtBar___"]',
          '.buff-extract-youpin-stack',
        ].join(', '),
        actionBuy: '[class*="actionBtn___"]',
        toastOk: '已复制',
        title: '复制游戏中检视链接',
      };
    }
    return null;
  })();

  if (!SITE) return;

  function showToast(message, isError) {
    let el = document.querySelector('.buff-extract-inspect-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'buff-extract-inspect-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle('is-error', !!isError);
    el.classList.add('is-visible');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.remove('is-visible'), 2800);
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  function contextFromRecord(rec) {
    if (!rec || rec.id == null) return null;
    return {
      commodityId: String(rec.id),
      templateHashName: pickTemplateName(rec),
      assetId: rec.steamAssetId || rec.assetId,
      actionLink:
        rec.actions ||
        rec.actionLink ||
        rec.shareUrl ||
        rec.inspectUrl ||
        null,
    };
  }

  function getReactDomKey(el) {
    if (!el) return null;
    for (const k of Object.getOwnPropertyNames(el)) {
      if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) {
        return k;
      }
    }
    return Object.keys(el).find(
      (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
    );
  }

  function findRecordInFiberTree(fiber, budget) {
    if (!fiber || budget <= 0) return null;
    const props = fiber.memoizedProps || fiber.pendingProps;
    if (props?.record?.id != null) {
      return contextFromRecord(props.record);
    }
    return (
      findRecordInFiberTree(fiber.child, budget - 1) ||
      findRecordInFiberTree(fiber.sibling, budget - 1)
    );
  }

  function isYoupinInspectLink(link) {
    if (!link) return false;
    const s = String(link);
    return (
      /^(steam|uuyp):\/\//.test(s) ||
      s.includes('csgo_econ_action_preview') ||
      s.includes('action_preview')
    );
  }

  const extApi = typeof chrome !== 'undefined' ? chrome : browser;

  let youpinBridgeReady = null;
  function ensureYoupinPageBridge() {
    if (SITE?.id !== 'youpin') return Promise.resolve();
    if (youpinBridgeReady) return youpinBridgeReady;
    youpinBridgeReady = new Promise((resolve, reject) => {
      try {
        const script = document.createElement('script');
        script.src = extApi.runtime.getURL('page-bridge.js');
        script.onload = () => resolve();
        script.onerror = () => {
          youpinBridgeReady = null;
          reject(new Error('page-bridge load failed'));
        };
        (document.documentElement || document.head).appendChild(script);
      } catch (e) {
        youpinBridgeReady = null;
        reject(e);
      }
    });
    return youpinBridgeReady;
  }

  function getYoupinTableRowIndex(row) {
    if (!row) return -1;
    const rows = document.querySelectorAll('tr.ant-table-row, tbody tr[data-row-key]');
    return Array.prototype.indexOf.call(rows, row);
  }

  function fetchYoupinRowContextByIndex(rowIndex) {
    if (rowIndex < 0) return Promise.resolve(null);
    return ensureYoupinPageBridge()
      .then(
        () =>
          new Promise((resolve) => {
            const requestId = `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const onResult = (ev) => {
              const data = ev.data;
              if (
                !data ||
                data.source !== 'buff-extract-page' ||
                data.type !== 'youpin-row-result' ||
                data.requestId !== requestId
              ) {
                return;
              }
              window.removeEventListener('message', onResult);
              clearTimeout(timer);
              resolve(data.result || null);
            };
            const timer = setTimeout(() => {
              window.removeEventListener('message', onResult);
              resolve(null);
            }, 1200);
            window.addEventListener('message', onResult);
            window.postMessage(
              {
                source: 'buff-extract-content',
                type: 'youpin-row',
                requestId,
                rowIndex,
              },
              '*'
            );
          })
      )
      .catch(() => null);
  }

  function getReactContextFromRow(row) {
    if (!row) return null;
    const nodes = [row, ...row.querySelectorAll('*')];
    for (const el of nodes) {
      const key = getReactDomKey(el);
      if (!key) continue;
      const fromTree = findRecordInFiberTree(el[key], 80);
      if (fromTree) return fromTree;
    }
    for (const el of row.querySelectorAll('td, [class*="actionBtn"]')) {
      const ctx = getReactContext(el);
      if (ctx?.commodityId || ctx?.actionLink) return ctx;
    }
    return null;
  }

  function getReactContext(el) {
    if (!el) return null;
    const key = getReactDomKey(el);
    if (!key) return null;
    const fromTree = findRecordInFiberTree(el[key], 50);
    if (fromTree) return fromTree;
    let fiber = el[key];
    for (let depth = 0; depth < 40 && fiber; depth++) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (props && typeof props === 'object') {
        if (props.record && props.record.id != null) {
          return contextFromRecord(props.record);
        }
        if (props.commodityId != null) {
          return {
            commodityId: String(props.commodityId),
            templateHashName: pickTemplateName(props),
            actionLink: props.actionLink,
          };
        }
        const detail = props.detail || props.detailData || props.productInfo;
        if (detail?.id != null) {
          return {
            commodityId: String(detail.id),
            templateHashName: pickTemplateName(detail),
            actionLink: detail.actionLink,
            assetId: detail.steamAssetId || detail.assetId,
          };
        }
        if (props.id != null && (props.marketHashName || props.commodityHashName || props.templateHashName)) {
          return {
            commodityId: String(props.id),
            templateHashName: pickTemplateName(props),
            actionLink: props.actionLink,
            assetId: props.steamAssetId || props.assetId,
          };
        }
        if (props.productId != null) {
          return { commodityId: String(props.productId) };
        }
      }
      fiber = fiber.return;
    }
    return null;
  }

  function pickTemplateName(obj) {
    return (
      obj.marketHashName ||
      obj.templateHashName ||
      obj.commodityHashName ||
      obj.CommodityHashName ||
      obj.templateName ||
      null
    );
  }

  function parseAssetInfoFromRow(node) {
    const tr = node.closest('tr');
    if (!tr) return null;
    for (const attr of ['data-asset_info', 'data-asset-info']) {
      const raw = tr.getAttribute(attr);
      if (!raw) continue;
      try {
        return JSON.parse(raw.replace(/&quot;/g, '"'));
      } catch {
        try {
          return JSON.parse(decodeURIComponent(raw));
        } catch {
          /* ignore */
        }
      }
    }
    return null;
  }

  function commodityIdFromPopover(container) {
    const pop =
      container.closest('[id^="popover_"][id$="_product"]') ||
      document.querySelector('[id^="popover_"][id$="_product"]');
    if (!pop?.id) return null;
    const m = pop.id.match(/^popover_(.+)_product$/);
    return m ? m[1] : null;
  }

  function applyYoupinContextToContainer(container, ctx) {
    if (!container || !ctx) return;
    if (ctx.commodityId || ctx.assetId || ctx.actionLink) {
      container.dataset.buffInspectCtx = JSON.stringify(ctx);
    }
    if (isYoupinInspectLink(ctx.actionLink)) {
      container.dataset.buffInspectLink = String(ctx.actionLink);
    }
  }

  async function collectYoupinContext(container, options) {
    const fresh = options?.fresh;
    if (!fresh) {
      const cached = container.dataset.buffInspectCtx;
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (
            parsed?.commodityId ||
            parsed?.assetId ||
            isYoupinInspectLink(parsed?.actionLink)
          ) {
            return parsed;
          }
        } catch {
          /* ignore */
        }
      }
    }

    const row = container.closest('tr.ant-table-row, tbody tr[data-row-key]');
    let fromFiber =
      getReactContextFromRow(row) ||
      getReactContext(container.querySelector('[class*="actionBtn"]')) ||
      getReactContext(container) ||
      getReactContext(container.querySelector('[class*="inspect-btn___"]'));

    if (!fromFiber?.actionLink && row) {
      const idx = getYoupinTableRowIndex(row);
      fromFiber = (await fetchYoupinRowContextByIndex(idx)) || fromFiber;
    }

    const commodityId =
      fromFiber?.commodityId ||
      container.dataset.commodityId ||
      commodityIdFromPopover(container);

    const ctx = {
      commodityId,
      assetId: fromFiber?.assetId,
      templateHashName: fromFiber?.templateHashName,
      actionLink: fromFiber?.actionLink,
    };

    applyYoupinContextToContainer(container, ctx);
    return ctx;
  }

  function parseAssetInfoFromBuy(buy) {
    if (!buy) return null;
    const direct = buy.getAttribute('data-assetid');
    if (direct) return direct;
    const raw = buy.getAttribute('data-asset-info');
    if (!raw) return null;
    try {
      const info = JSON.parse(String(raw).replace(/&quot;/g, '"'));
      return info?.assetid ?? info?.asset_id ?? null;
    } catch {
      try {
        const info = JSON.parse(decodeURIComponent(raw));
        return info?.assetid ?? info?.asset_id ?? null;
      } catch {
        return null;
      }
    }
  }

  function getBuffBuyButton(container) {
    const roots = [
      container?.closest?.('.buff-extract-buy-stack'),
      container,
    ].filter(Boolean);
    for (const root of roots) {
      const buy = root.querySelector('.btn-buy-order');
      if (buy) return buy;
    }
    return null;
  }

  function getAssetId(container) {
    const fromBuy = parseAssetInfoFromBuy(getBuffBuyButton(container));
    if (fromBuy) return fromBuy;

    const withId = container.querySelector('[data-assetid]');
    if (withId) {
      const id = withId.getAttribute('data-assetid');
      if (id) return id;
    }
    const info = parseAssetInfoFromRow(container);
    return info?.assetid ?? info?.asset_id ?? null;
  }

  function getExistingSteamLink(container) {
    const direct = container.querySelector(
      'a.csgo-action-link[href^="steam"], a[href*="csgo_econ_action_preview"]'
    );
    if (direct) {
      const href = direct.getAttribute('href');
      if (href && href.startsWith('steam')) return href;
    }
    const info = parseAssetInfoFromRow(container);
    if (info?.action_link && String(info.action_link).startsWith('steam')) {
      return info.action_link;
    }
    return null;
  }

  function parseInspectFromStream(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      try {
        const json = JSON.parse(trimmed);
        if (json.code === 'OK' && json.data) return String(json.data);
        if (json.error) throw new Error(json.error);
      } catch (e) {
        if (e.message && !e.message.includes('JSON')) throw e;
      }
    }
    const dataIndex = trimmed.indexOf('data:');
    if (dataIndex >= 0) {
      const end = trimmed.indexOf(',', dataIndex);
      const payload = end >= 0 ? trimmed.slice(dataIndex + 5, end) : trimmed.slice(dataIndex + 5);
      const link = payload.replace(/^"|"$/g, '');
      if (link.startsWith('steam')) return decodeURIComponent(link);
    }
    const steamMatch = trimmed.match(/steam:\/\/[^\s"'<>]+/);
    if (steamMatch) return steamMatch[0];
    return null;
  }

  async function fetchBuffInGameInspectLink(assetId) {
    const cacheKey = `buff:${assetId}`;
    if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

    const url = `https://buff.163.com/api/market/cs2_inspect?assetid=${encodeURIComponent(assetId)}&_=${Date.now()}`;
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });

    if (!res.ok) {
      throw new Error(`请求失败 (${res.status})，请确认已登录BUFF`);
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    let link = null;

    if (ct.includes('application/json')) {
      const json = await res.json();
      if (json.code !== 'OK') throw new Error(json.error || '无法获取检视链接');
      link = json.data;
    } else {
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true }).replaceAll('"', '');
        }
        link = parseInspectFromStream(buf);
      } else {
        link = parseInspectFromStream(await res.text());
      }
    }

    if (!link || !String(link).startsWith('steam')) {
      throw new Error('未返回有效的Steam检视链接');
    }

    const normalized = String(link);
    CACHE.set(cacheKey, normalized);
    return normalized;
  }

  function getYoupinDeviceId() {
    try {
      const fp = localStorage.getItem('fp');
      if (fp) return fp;
      const apm = localStorage.getItem('apmuuyp-web-pc');
      if (apm) {
        const parsed = JSON.parse(apm);
        if (parsed?.deviceId != null) return String(parsed.deviceId);
      }
      for (const part of document.cookie.split(';')) {
        const [rawKey, ...rest] = part.trim().split('=');
        if (rawKey === 'deviceId' && rest.length) {
          return decodeURIComponent(rest.join('='));
        }
      }
    } catch {
      /* ignore */
    }
    return '';
  }

  function getYoupinRequestHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'App-Version': '5.26.0',
      AppVersion: '5.26.0',
      'secret-v': 'h5_v1',
      appType: '1',
      platform: 'pc',
    };
    try {
      const uk = localStorage.getItem('WEB_UK');
      const deviceUk = localStorage.getItem('WEB_DEVICE_UK');
      if (uk) headers.uk = uk;
      if (deviceUk) headers.deviceUk = deviceUk;
      const deviceId = getYoupinDeviceId();
      if (deviceId) headers.deviceId = deviceId;
    } catch {
      /* ignore */
    }
    return headers;
  }

  async function youpinPost(path, body) {
    const apiPath = path.startsWith('/') ? path : `/${path.replace(/^\//, '')}`;
    const headers = getYoupinRequestHeaders();
    const url = `${location.origin}${apiPath}`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`请求失败 (${res.status})，请确认已登录悠悠有品`);
    }
    return res.json();
  }

  async function fetchYoupinInGameInspectLink(ctx) {
    const { commodityId, assetId, templateHashName, actionLink } = ctx;
    if (isYoupinInspectLink(actionLink)) {
      return String(actionLink);
    }

    const cacheKey = `youpin:${commodityId || assetId}`;
    if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

    const commodityIdNum = commodityId != null ? Number(commodityId) : null;

    if (commodityIdNum != null && !Number.isNaN(commodityIdNum)) {
      let info = await youpinPost(
        '/api/youpin/bff/new/commodity/v1/inspection/commodity/info',
        { commodityId: commodityIdNum }
      );
      if (info.code === 0 && info.data?.status === 2 && info.data?.shareUrl) {
        const link = String(info.data.shareUrl);
        CACHE.set(cacheKey, link);
        return link;
      }

      const hashName = templateHashName;
      if (hashName) {
        await youpinPost('/api/youpin/bff/new/commodity/v1/inspection/commodity/parse', {
          commodityId: commodityIdNum,
          templateHashName: hashName,
          inspectType: 1,
          sceneCode: 'PC-10501',
        });
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 600));
          info = await youpinPost(
            '/api/youpin/bff/new/commodity/v1/inspection/commodity/info',
            { commodityId: commodityIdNum }
          );
          if (info.code === 0 && info.data?.status === 2 && info.data?.shareUrl) {
            const link = String(info.data.shareUrl);
            CACHE.set(cacheKey, link);
            return link;
          }
        }
      }
    }

    if (assetId) {
      const info = await youpinPost('/api/youpin/bff/new/commodity/v1/inspection/asset/info', {
        assetId,
        realInspectType: 10,
      });
      if (info.code === 0 && info.data?.status === 2 && info.data?.shareUrl) {
        const link = String(info.data.shareUrl);
        CACHE.set(cacheKey, link);
        return link;
      }
    }

    throw new Error('无法获取检视链接');
  }

  async function resolveInspectLink(container) {
    const cached = container.dataset.buffInspectLink;
    if (cached && (SITE.id !== 'youpin' || isYoupinInspectLink(cached))) {
      return cached;
    }

    if (SITE.id === 'buff') {
      const existing = getExistingSteamLink(container);
      if (existing) {
        container.dataset.buffInspectLink = existing;
        return existing;
      }
      const assetId = getAssetId(container);
      if (!assetId) throw new Error('找不到饰品信息，请刷新页面后重试');
      const link = await fetchBuffInGameInspectLink(assetId);
      container.dataset.buffInspectLink = link;
      return link;
    }

    const row = container.closest('tr.ant-table-row, tbody tr[data-row-key]');
    let ctx = getReactContextFromRow(row);
    if (!isYoupinInspectLink(ctx?.actionLink)) {
      const idx = getYoupinTableRowIndex(row);
      ctx = (await fetchYoupinRowContextByIndex(idx)) || ctx;
    }
    if (!ctx) ctx = await collectYoupinContext(container, { fresh: true });
    else applyYoupinContextToContainer(container, ctx);

    if (isYoupinInspectLink(ctx?.actionLink)) {
      const direct = String(ctx.actionLink);
      container.dataset.buffInspectLink = direct;
      return direct;
    }

    const hasLink = isYoupinInspectLink(ctx.actionLink);
    if (!ctx.commodityId && !ctx.assetId && !hasLink) {
      throw new Error('找不到饰品信息，请刷新页面后重试');
    }
    const link = await fetchYoupinInGameInspectLink(ctx);
    container.dataset.buffInspectLink = link;
    return link;
  }

  function findStyleReference(container) {
    if (SITE.id === 'buff') {
      return getBuffBuyButton(container) || container.querySelector(SITE.buyBtn);
    }
    const selectors = [SITE.actionBuy, SITE.inspectBtn];
    for (const sel of selectors) {
      const el = container.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function syncOrangeBuyButtonStyle(btn, buy, layoutMode) {
    if (!buy) return;
    btn.classList.add(`${BTN_CLASS}--buy-orange`);
    const cs = getComputedStyle(buy);
    const isRow = layoutMode === 'row';
    const rect = buy.getBoundingClientRect();

    btn.style.display = isRow ? 'inline-flex' : 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.boxSizing = 'border-box';
    btn.style.margin = '0';
    btn.style.padding = cs.padding;
    btn.style.fontSize = cs.fontSize;
    btn.style.fontWeight = cs.fontWeight;
    btn.style.lineHeight = 'normal';
    btn.style.borderRadius = cs.borderRadius;
    btn.style.textAlign = 'center';
    btn.style.border = 'none';
    btn.style.color = '#fff';
    btn.style.backgroundColor = '#FF9933';
    btn.style.minWidth = cs.minWidth;
    btn.style.maxWidth = cs.maxWidth;

    if (rect.width > 0) {
      btn.style.width = `${rect.width}px`;
    } else {
      btn.style.width = cs.width;
    }
    if (rect.height > 0) {
      btn.style.height = `${rect.height}px`;
    } else {
      btn.style.height = cs.height;
    }
  }

  function removeBuffLegacyButtons() {
    document
      .querySelectorAll(
        `.g_Right .${BTN_CLASS}, .scope-btns .${BTN_CLASS}, .csgo_value .${BTN_CLASS}, .inspect-thum-btns .${BTN_CLASS}`
      )
      .forEach((btn) => btn.remove());
  }

  const BUFF_ITEM_POPUP_SEL =
    '#j_popup_item_detail, #j_popup_handbook_item_detail';

  function removeBuffPopupExtractUI() {
    document.querySelectorAll(BUFF_ITEM_POPUP_SEL).forEach((pop) => {
      if (
        !pop.querySelector(
          `.${BTN_CLASS}, .buff-extract-buy-stack, .buff-extract-action-row`
        )
      ) {
        return;
      }

      pop.querySelectorAll(`.${BTN_CLASS}`).forEach((btn) => btn.remove());

      pop.querySelectorAll('.buff-extract-action-row').forEach((row) => {
        row.classList.remove('buff-extract-action-row');
      });

      pop.querySelectorAll('.buff-extract-buy-stack').forEach((stack) => {
        if (!stack.querySelector(`.${BTN_CLASS}`)) return;
        const parent = stack.parentElement;
        if (!parent) return;
        [...stack.childNodes].forEach((node) => {
          if (node.nodeType === 1 && node.classList?.contains(BTN_CLASS)) return;
          parent.insertBefore(node, stack);
        });
        stack.remove();
      });
    });
  }

  function injectBuffListBelowBuy(buy) {
    if (!buy) return;
    if (buy.id === 'batch-buy-btn' || buy.id === 'batch-buy-btn2') return;

    let stack = buy.closest('.buff-extract-buy-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'buff-extract-buy-stack buff-extract-buy-stack--below';
      const parent = buy.parentElement;
      if (!parent) return;
      parent.insertBefore(stack, buy);
      stack.appendChild(buy);
    } else {
      stack.classList.remove('buff-extract-buy-stack--right');
      stack.classList.add('buff-extract-buy-stack--below');
    }

    let btn = stack.querySelector(`.${BTN_CLASS}`);
    if (!btn) {
      btn = createExtractButton();
      stack.appendChild(btn);
    } else {
      bindExtractButton(btn);
    }
    syncOrangeBuyButtonStyle(btn, buy, 'column');
  }

  function scanBuffBuyButtons() {
    removeBuffLegacyButtons();
    removeBuffPopupExtractUI();

    document
      .querySelectorAll('tr[data-asset_info] .btn-buy-order, .list_tb .btn-buy-order')
      .forEach((buy) => {
        if (buy.closest(BUFF_ITEM_POPUP_SEL)) {
          return;
        }
        injectBuffListBelowBuy(buy);
      });

    document.querySelectorAll('.buff-extract-buy-stack--below').forEach((stack) => {
      const btn = stack.querySelector(`.${BTN_CLASS}`);
      const buy = stack.querySelector('.btn-buy-order');
      if (btn && buy) syncOrangeBuyButtonStyle(btn, buy, 'column');
    });
  }

  function syncHeightWithNeighbors(btn, container) {
    if (
      container.classList.contains('buff-extract-buy-stack') ||
      container.classList.contains('buff-extract-youpin-stack')
    ) {
      const buy =
        container.querySelector('.btn-buy-order') ||
        container.querySelector(SITE.actionBuy);
      const layout = container.classList.contains('buff-extract-buy-stack--below')
        ? 'column'
        : 'row';
      syncOrangeBuyButtonStyle(btn, buy, layout);
      if (container.classList.contains('buff-extract-youpin-stack')) {
        btn.classList.add(`${BTN_CLASS}--youpin-list`);
      }
      return;
    }
    const ref = findStyleReference(container);
    if (!ref) return;
    syncOrangeBuyButtonStyle(btn, ref, 'column');
  }

  function insertExtractButton(container, btn) {
    container.appendChild(btn);
  }

  function setExtractButtonLabel(btn, label) {
    btn.textContent = label;
  }

  function bindExtractButton(btn) {
    if (!btn || btn.dataset.buffExtractBound === '1') return;
    btn.dataset.buffExtractBound = '1';
    btn.setAttribute('role', 'button');
    btn.tabIndex = 0;

    const stopBubble = (e) => {
      e.stopPropagation();
    };
    btn.addEventListener('mousedown', stopBubble, true);
    btn.addEventListener('pointerdown', stopBubble, true);

    btn.addEventListener(
      'click',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onExtractClick(e);
      },
      true
    );
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      onExtractClick(Object.assign(e, { currentTarget: btn }));
    });
  }

  async function onExtractClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    const btn = ev.currentTarget;
    const container =
      btn.closest('.buff-extract-buy-stack, .buff-extract-youpin-stack') ||
      btn.closest(SITE.groups) ||
      btn.parentElement;
    if (!container) return;

    if (btn.classList.contains('is-loading')) return;
    btn.classList.add('is-loading');
    const prevText = btn.textContent;
    setExtractButtonLabel(btn, '…');

    try {
      const link = await resolveInspectLink(container);
      await copyText(link);
      setExtractButtonLabel(btn, '已复制');
      btn.classList.add('is-ok');
      showToast(SITE.toastOk);
      setTimeout(() => {
        setExtractButtonLabel(btn, BTN_LABEL);
        btn.classList.remove('is-ok');
      }, 1600);
    } catch (err) {
      setExtractButtonLabel(btn, prevText);
      showToast(err.message || '提取失败', true);
    } finally {
      btn.classList.remove('is-loading');
    }
  }

  function createExtractButton() {
    const btn = document.createElement('span');
    btn.className = BTN_CLASS;
    btn.textContent = BTN_LABEL;
    if (SITE.id === 'youpin') btn.classList.add(`${BTN_CLASS}--youpin`);
    btn.title = SITE.title;
    bindExtractButton(btn);
    return btn;
  }

  function shouldInjectGroup(container) {
    if (!container || container.querySelector(`.${BTN_CLASS}`)) return false;
    if (SITE.id === 'buff') return false;
    if (container.classList.contains('buff-extract-youpin-stack')) return true;
    if (SITE.id === 'youpin') {
      if (container.matches('[class*="wear-degree-box___"]')) return false;
      if (container.closest('tr.ant-table-row, tbody tr[data-row-key]')) {
        return false;
      }
    }
    if (container.querySelector(SITE.inspectBtn)) return true;
    return false;
  }

  function injectIntoGroup(container) {
    if (!shouldInjectGroup(container)) return;
    const btn = createExtractButton();
    syncHeightWithNeighbors(btn, container);
    insertExtractButton(container, btn);
    if (SITE.id === 'youpin' && container.classList.contains('buff-extract-youpin-stack')) {
      void primeYoupinStack(container, container.closest('tr.ant-table-row, tbody tr[data-row-key]'));
    }
  }

  async function primeYoupinStack(stack, row) {
    if (!stack) return;
    let ctx = getReactContextFromRow(row);
    applyYoupinContextToContainer(stack, ctx);
    if (!isYoupinInspectLink(ctx?.actionLink) && row) {
      const idx = getYoupinTableRowIndex(row);
      ctx = (await fetchYoupinRowContextByIndex(idx)) || ctx;
      applyYoupinContextToContainer(stack, ctx);
    }
  }

  function removeYoupinMisplacedButtons(row) {
    if (!row) return;
    row.querySelectorAll('[class*="wear-degree-box___"]').forEach((wear) => {
      wear.querySelectorAll(`.${BTN_CLASS}`).forEach((btn) => btn.remove());
    });
    row.querySelectorAll(`.${BTN_CLASS}`).forEach((btn) => {
      if (!btn.closest('.buff-extract-youpin-stack')) btn.remove();
    });
  }

  function injectYoupinListRow(row) {
    if (!row) return;
    removeYoupinMisplacedButtons(row);
    const buy = row.querySelector(SITE.actionBuy);
    if (!buy) return;

    const cell = buy.closest('td') || buy.parentElement;
    if (!cell) return;

    let stack = cell.querySelector('.buff-extract-youpin-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'buff-extract-youpin-stack';
      cell.insertBefore(stack, buy);
      stack.appendChild(buy);
    }

    if (stack.querySelector(`.${BTN_CLASS}`)) return;

    const btn = createExtractButton();
    syncHeightWithNeighbors(btn, stack);
    stack.appendChild(btn);
    void primeYoupinStack(stack, row);
  }

  function resyncHeights() {
    document.querySelectorAll(`.${BTN_CLASS}`).forEach((btn) => {
      const container = btn.parentElement;
      if (container) syncHeightWithNeighbors(btn, container);
    });
  }

  function scanPage() {
    if (SITE.id === 'buff') {
      scanBuffBuyButtons();
    } else {
      document.querySelectorAll(SITE.groups).forEach(injectIntoGroup);

      document.querySelectorAll(SITE.inspectBtn).forEach((el) => {
        const group = el.closest(SITE.groups);
        if (group) return;
        const parent = el.parentElement;
        if (!parent || parent.querySelector(`.${BTN_CLASS}`)) return;
        if (!parent.querySelector(SITE.inspectBtn)) return;
        injectIntoGroup(parent);
      });

      if (SITE.id === 'youpin') {
        document.querySelectorAll('tr.ant-table-row').forEach(injectYoupinListRow);
      }
    }

    resyncHeights();
  }

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scanPage();
    });
  }

  const observer = new MutationObserver(scheduleScan);

  function init() {
    if (SITE.id === 'youpin') {
      void ensureYoupinPageBridge();
    }
    scanPage();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
