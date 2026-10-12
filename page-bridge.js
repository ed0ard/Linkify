// Copyright (c) 2026 ed0ard. All rights reserved.
(function () {
  if (window.__buffExtractYoupinBridge) return;
  window.__buffExtractYoupinBridge = true;

  function fiberKey(el) {
    var names = Object.getOwnPropertyNames(el);
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (n.indexOf('__reactFiber$') === 0 || n.indexOf('__reactInternalInstance$') === 0) {
        return n;
      }
    }
    return null;
  }

  function findRec(f, b) {
    if (!f || b <= 0) return null;
    var p = f.memoizedProps || f.pendingProps;
    if (p && p.record && p.record.id != null) return p.record;
    return findRec(f.child, b - 1) || findRec(f.sibling, b - 1);
  }

  function rowContextByIndex(rowIndex) {
    var rows = document.querySelectorAll('tr.ant-table-row, tbody tr[data-row-key]');
    var row = rows[rowIndex];
    if (!row) return null;
    var nodes = [row];
    var all = row.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) nodes.push(all[j]);
    for (var k = 0; k < nodes.length; k++) {
      var key = fiberKey(nodes[k]);
      if (!key) continue;
      var rec = findRec(nodes[k][key], 80);
      if (rec) {
        return {
          commodityId: String(rec.id),
          templateHashName:
            rec.commodityHashName || rec.templateHashName || rec.marketHashName || null,
          assetId: rec.steamAssetId || rec.assetId || null,
          actionLink: rec.actions || rec.actionLink || rec.shareUrl || rec.inspectUrl || null,
        };
      }
    }
    return null;
  }

  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data || data.source !== 'buff-extract-content' || data.type !== 'youpin-row') return;
    var result = rowContextByIndex(data.rowIndex);
    window.postMessage(
      {
        source: 'buff-extract-page',
        type: 'youpin-row-result',
        requestId: data.requestId,
        result: result,
      },
      '*'
    );
  });
})();
