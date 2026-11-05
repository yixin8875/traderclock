// 启动动画脚本：放在 public 目录，不经过打包，页面一加载就运行。
(function () {
  // 启动动画画出来后立刻显示窗口，用户看到的第一眼就是动画而不是白屏
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      var t = window.__TAURI_INTERNALS__;
      if (t && t.invoke) t.invoke("window_ready").catch(function () {});
    });
  });

  // 轮换提示文字，和软件做的事情对应
  var msgs = ["正在对表…", "对齐芝加哥时间…", "换算夏令时…", "翻看休市日历…", "数一数下一根 K 线…"];
  var i = 0;
  var el = document.getElementById("splash-msg");
  var timer = setInterval(function () {
    if (!el) return;
    el.style.opacity = "0";
    setTimeout(function () {
      i = (i + 1) % msgs.length;
      el.textContent = msgs[i];
      el.style.opacity = "1";
    }, 200);
  }, 1100);

  // React 第一帧渲染完后调用：淡出并移除动画
  window.__hideSplash = function () {
    var s = document.getElementById("splash");
    if (!s) return;
    clearInterval(timer);
    s.classList.add("out");
    setTimeout(function () { s.remove(); }, 320);
  };
})();
