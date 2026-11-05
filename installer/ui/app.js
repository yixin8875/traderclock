(() => {
  const app = document.getElementById("app");
  const states = {
    welcome: document.querySelector(".state-welcome"),
    installing: document.querySelector(".state-installing"),
    success: document.querySelector(".state-success"),
    error: document.querySelector(".state-error"),
  };
  const installMessage = document.getElementById("install-message");
  const errorMessage = document.getElementById("error-message");
  const progress = document.getElementById("progress");
  const stepItems = Array.from(document.querySelectorAll("#steps li"));
  const order = ["preparing", "installing", "finalizing", "done"];

  const hasTauri = Boolean(window.__TAURI__ && window.__TAURI__.core);
  const demo = !hasTauri;
  let installedPath = "";
  let unlisten = null;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function showState(name) {
    app.dataset.state = name;
    for (const [key, el] of Object.entries(states)) {
      el.hidden = key !== name;
    }
    const active = states[name];
    if (name === "installing") {
      resetSteps();
      app.dataset.phase = "preparing";
      progress.setAttribute("aria-valuenow", "24");
    }
    if (name === "error") {
      requestAnimationFrame(() => document.getElementById("retry-btn").focus({ preventScroll: true }));
    }
  }

  function resetSteps() {
    stepItems.forEach((li, index) => {
      li.classList.toggle("active", index === 0);
      li.classList.remove("done");
    });
    installMessage.textContent = "正在准备安装文件…";
  }

  function markPhase(phase, message) {
    const next = order.includes(phase) ? phase : "installing";
    if (message) installMessage.textContent = message;
    app.dataset.phase = next;

    const index = order.indexOf(next);
    stepItems.forEach((li) => {
      const own = order.indexOf(li.dataset.step);
      li.classList.toggle("done", next === "done" || own < index);
      li.classList.toggle("active", next !== "done" && own === index);
    });

    const percent = next === "done" ? 100 : next === "finalizing" ? 86 : next === "installing" ? 58 : 24;
    progress.setAttribute("aria-valuenow", String(percent));
  }

  function showError(reason) {
    const text =
      typeof reason === "string"
        ? reason
        : reason && typeof reason.message === "string"
          ? reason.message
          : "安装程序未能完成，请重试。";
    errorMessage.textContent = text;
    showState("error");
  }

  async function startInstall() {
    showState("installing");
    markPhase("preparing", "正在准备安装文件…");

    if (demo) {
      await delay(850);
      markPhase("installing", "正在安装 TradeClock…");
      await delay(1950);
      markPhase("finalizing", "正在完成最后的设置…");
      await delay(850);
      markPhase("done", "安装完成");
      await delay(520);
      showState("success");
      return;
    }

    try {
      unlisten = await window.__TAURI__.event.listen("install-phase", (event) => {
        const payload = event.payload || {};
        markPhase(payload.phase, payload.message);
      });

      installedPath = await window.__TAURI__.core.invoke("install_app");
      markPhase("done", "安装完成");
      await delay(520);
      showState("success");
    } catch (error) {
      showError(error);
    } finally {
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    }
  }

  async function launch() {
    if (demo) {
      installedPath = "%LOCALAPPDATA%\\TradeClock\\tradeclock.exe";
      showState("success");
      return;
    }
    try {
      await window.__TAURI__.core.invoke("launch_app", { path: installedPath });
      await window.__TAURI__.core.invoke("close_setup");
    } catch (error) {
      showError(error);
    }
  }

  async function finish() {
    if (demo) return;
    await window.__TAURI__.core.invoke("close_setup");
  }

  document.getElementById("install-btn").addEventListener("click", startInstall);
  document.getElementById("retry-btn").addEventListener("click", startInstall);
  document.getElementById("launch-btn").addEventListener("click", launch);
  document.getElementById("finish-btn").addEventListener("click", finish);
  document.getElementById("error-close-btn").addEventListener("click", finish);

  // Browser preview helper: lets the UI be driven without Tauri.
  window.__setupDemo = {
    startInstall,
    showState,
    markPhase,
    showError,
    launch,
  };
})();
