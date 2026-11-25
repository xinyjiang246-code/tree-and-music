/* =========================================================
   主题曲 · 从一首歌里抽出单条旋律
   ---------------------------------------------------------
   步骤：单声道下混 → 降采样 → 分帧 → YIN 基频跟踪
        → 能量/置信度门限 → 中值平滑 → 音符分割
   输出两种"状态"，不混在一起：
     voiced   —— 听清了，给出音高
     unclear  —— 有声音但听不清（复音、噪声），留空
     quiet    —— 基本没声音
   听不清的段落只标出来，不填猜测值。
   ========================================================= */
(function (root) {
  'use strict';

  var PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
  var BASE = 130.81;       // C3，与 app.js 的 scheduleNote 一致

  var DEFAULTS = {
    targetSr: 5512,        // 约 44.1k/8，基频跟踪够用，速度快一个量级
    frame: 512,            // ≈ 85–93 ms
    hop: 128,              // ≈ 21–23 ms
    minHz: 70,
    maxHz: 1000,
    confMin: 0.62,         // 1 - YIN 累积均值归一化差值
    noteMin: 0.09,         // 最短音符（秒）
    gapMin: 0.35,          // 超过这么长的"听不清"才会标注
    maxSeconds: 180
  };

  function midiOf(hz) { return 69 + 12 * Math.log(hz / 440) / Math.LN2; }
  function hzOf(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  /* ---------- 1. 单声道下混（可只取一段） ---------- */
  function toMono(buffer, start, end) {
    var sr = buffer.sampleRate;
    var s = Math.max(0, Math.floor((start || 0) * sr));
    var e = end ? Math.min(buffer.length, Math.floor(end * sr)) : buffer.length;
    var n = Math.max(0, e - s);
    var chs = buffer.numberOfChannels || 1;
    var out = new Float32Array(n);
    for (var c = 0; c < chs; c++) {
      var d = buffer.getChannelData(c);
      for (var i = 0; i < n; i++) out[i] += d[s + i] / chs;
    }
    return out;
  }

  /* ---------- 2. 降采样（盒式平均，兼作抗混叠低通） ---------- */
  function downsample(x, sr, targetSr) {
    var factor = Math.max(1, Math.floor(sr / targetSr));
    if (factor === 1) return { x: x, sr: sr, factor: 1 };
    var n = Math.floor(x.length / factor);
    var y = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var sum = 0, base = i * factor;
      for (var k = 0; k < factor; k++) sum += x[base + k];
      y[i] = sum / factor;
    }
    return { x: y, sr: sr / factor, factor: factor };
  }

  /* ---------- 3. 单帧 YIN ---------- */
  function framePitch(x, off, W, minLag, maxLag, sr) {
    var len = W - maxLag;
    if (len < 32) return null;

    var d = new Float64Array(maxLag + 1);
    for (var tau = 1; tau <= maxLag; tau++) {
      var s = 0;
      for (var i = 0; i < len; i++) {
        var df = x[off + i] - x[off + i + tau];
        s += df * df;
      }
      d[tau] = s;
    }

    // 累积均值归一化差值：消除"越往后越小"的偏置
    var run = 0, dd = new Float64Array(maxLag + 1);
    for (tau = 1; tau <= maxLag; tau++) {
      run += d[tau];
      dd[tau] = run > 0 ? d[tau] * tau / run : 1;
    }

    var bestTau = -1, bestVal = Infinity, dip = -1;
    for (tau = minLag; tau <= maxLag; tau++) {
      if (dd[tau] < 0.18) {           // 第一个低于阈值的谷
        var t = tau;
        while (t + 1 <= maxLag && dd[t + 1] < dd[t]) t++;
        dip = t;
        break;
      }
      if (dd[tau] < bestVal) { bestVal = dd[tau]; bestTau = tau; }
    }
    if (dip > 0) bestTau = dip;
    if (bestTau < 0) return null;

    // 抛物线插值，把 lag 精确到小数
    var lag = bestTau;
    if (bestTau > 1 && bestTau < maxLag) {
      var a = dd[bestTau - 1], b = dd[bestTau], c = dd[bestTau + 1];
      var den = a - 2 * b + c;
      if (Math.abs(den) > 1e-12) lag = bestTau + 0.5 * (a - c) / den;
    }
    if (!(lag > 0)) return null;

    var conf = Math.max(0, Math.min(1, 1 - dd[bestTau]));
    var hz = sr / lag;
    if (hz < 55 || hz > 1400) return null;
    return { hz: hz, conf: conf };
  }

  /* ---------- 4. 一小段内的中值平滑 ---------- */
  function medianSmooth(values, voiced) {
    var n = values.length, out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      out[i] = values[i];
      if (!voiced[i]) continue;
      var win = [];
      for (var k = i - 2; k <= i + 2; k++) {
        if (k >= 0 && k < n && voiced[k]) win.push(values[k]);
      }
      if (win.length >= 3) {
        win.sort(function (a, b) { return a - b; });
        var med = win[(win.length / 2) | 0];
        if (Math.abs(med - values[i]) <= 1.6) out[i] = med;   // 只抹平抖动，不改大跳
      }
    }
    return out;
  }

  /* ---------- 5. 主流程 ---------- */
  function extract(buffer, options) {
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    if (options) for (var k2 in options) if (options[k2] != null) o[k2] = options[k2];

    var start = Math.max(0, options && options.start || 0);
    var end = options && options.end ? options.end : 0;
    var limit = o.maxSeconds;
    if (!end || end - start > limit) end = start + Math.min(limit, (buffer.duration || 0) - start);

    var mono = toMono(buffer, start, end);
    var down = downsample(mono, buffer.sampleRate, o.targetSr);
    var x = down.x, sr = down.sr;
    var W = o.frame, hop = o.hop;
    var hopT = hop / sr;
    var minLag = Math.max(2, Math.floor(sr / o.maxHz));
    var maxLag = Math.min(W - 64, Math.ceil(sr / o.minHz));

    var nFrames = Math.max(0, Math.floor((x.length - W) / hop) + 1);
    if (nFrames < 4) {
      return { ok: false, reason: 'too-short', frames: 0, notes: [], points: [], gaps: [], duration: 0 };
    }

    // 能量
    var rms = new Float32Array(nFrames);
    for (var f = 0; f < nFrames; f++) {
      var off = f * hop, s = 0;
      for (var i = 0; i < W; i++) { var v = x[off + i]; s += v * v; }
      rms[f] = Math.sqrt(s / W);
    }
    var sorted = Array.prototype.slice.call(rms).sort(function (a, b) { return a - b; });
    var loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))] || 0;
    var floor = Math.max(0.0035, loud * 0.10);

    var rawMidi = new Float32Array(nFrames);
    var conf = new Float32Array(nFrames);
    var voiced0 = new Uint8Array(nFrames);
    var unclear = new Uint8Array(nFrames);
    var quiet = new Uint8Array(nFrames);

    for (f = 0; f < nFrames; f++) {
      if (rms[f] < floor) { quiet[f] = 1; continue; }
      var p = framePitch(x, f * hop, W, minLag, maxLag, sr);
      if (!p) { unclear[f] = 1; continue; }
      rawMidi[f] = midiOf(p.hz);
      conf[f] = p.conf;
      if (p.conf >= o.confMin) voiced0[f] = 1;
      else unclear[f] = 1;
    }

    var midi = medianSmooth(rawMidi, voiced0);

    // 音符分割：同一音级连续合并；无音帧直接断开，不桥接猜测
    var notes = [], cur = null;
    function closeCur(t1) {
      if (!cur) return;
      cur.t1 = t1;
      if (cur.t1 - cur.t0 >= o.noteMin) {
        cur.midi = Math.round(cur.midi * 10) / 10;
        cur.hz = hzOf(cur.midi);
        notes.push(cur);
      }
      cur = null;
    }
    for (f = 0; f < nFrames; f++) {
      var t = f * hopT;
      if (voiced0[f]) {
        var m = midi[f];
        if (cur && Math.abs(m - cur.midi) <= 0.7) {
          cur.n++;
          cur.midiSum += m;
          cur.confSum += conf[f];
          cur.midi = cur.midiSum / cur.n;
        } else {
          closeCur(t);
          cur = { t0: t, t1: t + hopT, midi: m, midiSum: m, confSum: conf[f], n: 1 };
        }
      } else {
        closeCur(t);
      }
    }
    closeCur(nFrames * hopT);

    notes.forEach(function (n) {
      n.midi = Math.round(n.midi * 10) / 10;
      n.hz = hzOf(n.midi);
      n.conf = n.confSum / Math.max(1, n.n);
      delete n.midiSum; delete n.confSum; delete n.n;
    });

    // "听不清"区段：有能量但置信度不够，且足够长
    var gaps = [], gs = -1;
    for (f = 0; f <= nFrames; f++) {
      var isUnclear = f < nFrames && unclear[f] && !voiced0[f];
      if (isUnclear && gs < 0) gs = f;
      if (!isUnclear && gs >= 0) {
        var g0 = gs * hopT, g1 = f * hopT;
        if (g1 - g0 >= o.gapMin) gaps.push({ t0: g0, t1: g1 });
        gs = -1;
      }
    }

    var active = 0, voicedN = 0;
    for (f = 0; f < nFrames; f++) {
      if (!quiet[f]) { active++; if (voiced0[f]) voicedN++; }
    }
    var coverage = active ? voicedN / active : 0;
    var duration = nFrames * hopT;

    // 画线用的抽稀点（听不清处为 null，线自然断开）
    var maxPts = 900;
    var step = Math.max(1, Math.ceil(nFrames / maxPts));
    var points = [];
    for (f = 0; f < nFrames; f += step) {
      points.push({ t: f * hopT, midi: voiced0[f] ? midi[f] : null });
    }

    var minM = 999, maxM = -999;
    notes.forEach(function (n) { if (n.midi < minM) minM = n.midi; if (n.midi > maxM) maxM = n.midi; });

    var totalVoiced = 0;
    notes.forEach(function (n) { totalVoiced += n.t1 - n.t0; });

    var ok = notes.length >= 3 && coverage >= 0.08 && totalVoiced >= 0.4;

    return {
      ok: ok,
      reason: ok ? null : (notes.length === 0 ? 'nothing' : 'unclear'),
      frames: nFrames,
      duration: duration,
      coverage: coverage,
      notes: notes,
      points: points,
      gaps: gaps,
      minMidi: notes.length ? minM : null,
      maxMidi: notes.length ? maxM : null,
      truncated: !!(buffer.duration && end - start < buffer.duration - 0.1)
    };
  }

  /* ---------- 6. 量化到这棵树：五声音阶 + 真实枝梢 ---------- */
  function quantize(notes, tips, box, opts) {
    var P = (opts && opts.penta) || PENTA;
    var B = (opts && opts.base) || BASE;
    var bx = box || { y0: 0, y1: 1 };
    var span = Math.max(1, bx.y1 - bx.y0);

    var out = notes.map(function (n) {
      var bestK = 0, bestOct = 0, bestDiff = Infinity;
      // 同一条音可以有多个写法（deg 12 = 本八度第 5 个音，也 = 高八度第 0 个音）
      // 优先离本八度最近的写法，音高与枝梢高度才对得上
      var OCTS = [0, 1, -1, 2, -2];
      for (var oi = 0; oi < OCTS.length; oi++) {
        for (var k = 0; k < P.length; k++) {
          var absDeg = P[k] + 12 * OCTS[oi];
          var diff = Math.abs(n.midi - (48 + absDeg));   // C3 = MIDI 48
          if (diff < bestDiff - 1e-9) { bestDiff = diff; bestK = k; bestOct = OCTS[oi]; }
        }
      }
      var absDeg = P[bestK] + 12 * bestOct;
      // 八度折叠：男声/女声都可能落在树音域（C3–E5）之外，折回来而不是丢音
      while (absDeg < 0) absDeg += 12;
      while (absDeg > P[P.length - 1]) absDeg -= 12;
      var kk = 0;
      for (var ki = 0; ki < P.length; ki++) if (P[ki] === absDeg) { kk = ki; break; }
      var rel = (kk + 0.5) / P.length;                    // 与 scheduleNote 的 rel→deg 一致
      return {
        t0: n.t0, t1: n.t1,
        midi: n.midi,
        midiQ: 48 + absDeg,
        deg: absDeg,
        hz: B * Math.pow(2, absDeg / 12),
        rel: rel,
        conf: n.conf,
        drift: bestDiff
      };
    });

    // 高音 → 高处的枝梢；同一高度附近随机挑一枝，避免总亮同一根
    if (tips && tips.length) {
      out.forEach(function (n) {
        var yTarget = bx.y0 + (1 - n.rel) * span;
        var near = [];
        var best = null, bestD = Infinity;
        for (var i = 0; i < tips.length; i++) {
          var d = Math.abs(tips[i].y - yTarget);
          if (d < bestD) { bestD = d; best = tips[i]; }
          if (d <= span * 0.015) near.push(tips[i]);
        }
        var pick = near.length ? near[(Math.random() * near.length) | 0] : best;
        if (pick) { n.tipX = pick.x; n.tipY = pick.y; }
      });
    }
    return out;
  }

  /* ---------- 7. 画"时间-音高"线 ---------- */
  function draw(canvas, data, sel) {
    if (!canvas) return null;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 360;
    var h = canvas.clientHeight || 150;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    var padL = 10, padR = 10, padT = 12, padB = 16;
    var iw = Math.max(1, w - padL - padR);
    var ih = Math.max(1, h - padT - padB);

    // 底
    g.fillStyle = 'rgba(255,255,255,0.025)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(233,194,122,0.22)';
    g.strokeRect(padL, padT, iw, ih);

    if (!data || (!(data.notes && data.notes.length) && !(data.fail && data.points && data.points.length))) {
      g.fillStyle = 'rgba(233,214,180,0.5)';
      g.font = '12px -apple-system, "PingFang SC", sans-serif';
      g.textAlign = 'center';
      g.fillText('还没有主题曲 · 选一首歌，抽它的旋律', w / 2, h / 2 + 4);
      g.textAlign = 'left';
      return null;
    }

    var dur = Math.max(0.5, data.duration || 1);
    var lo = 999, hi = -999;
    (data.notes || []).forEach(function (n) {
      lo = Math.min(lo, n.midiQ); hi = Math.max(hi, n.midiQ);
    });
    if (lo > hi) {
      (data.points || []).forEach(function (p) {
        if (p.midi == null) return;
        lo = Math.min(lo, p.midi); hi = Math.max(hi, p.midi);
      });
    }
    if (lo > hi) { lo = 55; hi = 72; }
    lo -= 2; hi += 2;
    if (hi - lo < 7) { var mid = (hi + lo) / 2; lo = mid - 4; hi = mid + 4; }
    var yOf = function (m) { return padT + (1 - (m - lo) / (hi - lo)) * ih; };
    var xOf = function (t) { return padL + Math.max(0, Math.min(1, t / dur)) * iw; };

    // 五声音阶横线：树真正拥有的音高
    g.lineWidth = 1;
    for (var oct = -1; oct <= 1; oct++) {
      for (var k = 0; k < PENTA.length; k++) {
        var m = 48 + PENTA[k] + 12 * oct;
        if (m < lo || m > hi) continue;
        var y = yOf(m);
        g.strokeStyle = 'rgba(233,194,122,0.10)';
        g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + iw, y); g.stroke();
      }
    }

    // 听不清的区段：留空 + 标注，不画线
    g.save();
    g.beginPath(); g.rect(padL, padT, iw, ih); g.clip();
    (data.gaps || []).forEach(function (gap) {
      var x0 = xOf(gap.t0), x1 = xOf(gap.t1);
      g.fillStyle = 'rgba(224,122,86,0.16)';
      g.fillRect(x0, padT, Math.max(1, x1 - x0), ih);
      if (x1 - x0 > 26) {
        g.fillStyle = 'rgba(240,168,132,0.95)';
        g.font = '9px -apple-system, "PingFang SC", sans-serif';
        g.fillText('听不清', x0 + 4, padT + 11);
      }
    });

    // 旋律线
    g.strokeStyle = 'rgba(242,196,119,0.92)';
    g.lineWidth = 1.5;
    g.lineJoin = 'round';
    g.beginPath();
    var pen = false;
    (data.points || []).forEach(function (p) {
      if (p.midi == null) { pen = false; return; }
      var x = xOf(p.t), y = yOf(p.midi);
      if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
    });
    g.stroke();

    // 量化后的音（落在树的音上）
    (data.notes || []).forEach(function (n) {
      var x = xOf((n.t0 + n.t1) / 2), y = yOf(n.midiQ);
      g.fillStyle = 'rgba(255,230,170,0.95)';
      g.beginPath(); g.arc(x, y, 2.4, 0, 6.2832); g.fill();
    });

    // 圈选
    if (sel && sel.t1 - sel.t0 > 0.15) {
      var sx0 = xOf(sel.t0), sx1 = xOf(sel.t1);
      g.fillStyle = 'rgba(242,196,119,0.16)';
      g.fillRect(sx0, padT, sx1 - sx0, ih);
      g.strokeStyle = 'rgba(255,226,164,0.9)';
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(sx0, padT); g.lineTo(sx0, padT + ih);
      g.moveTo(sx1, padT); g.lineTo(sx1, padT + ih); g.stroke();
      g.setLineDash([]);
    }
    g.restore();

    // 时间刻度
    function fmt(sec) {
      var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
    g.fillStyle = 'rgba(233,214,180,0.45)';
    g.font = '9px -apple-system, "PingFang SC", sans-serif';
    g.fillText('0:00', padL, h - 4);
    g.textAlign = 'right';
    g.fillText(fmt(dur), padL + iw, h - 4);
    g.textAlign = 'left';

    return { padL: padL, padT: padT, iw: iw, ih: ih, dur: dur };
  }

  var api = {
    extract: extract,
    quantize: quantize,
    draw: draw,
    midiOf: midiOf,
    hzOf: hzOf,
    PENTA: PENTA,
    BASE: BASE
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Melody = api;
})(typeof window !== 'undefined' ? window : null);
