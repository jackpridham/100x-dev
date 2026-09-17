(function initializeOptions() {
  "use strict";
  const core = globalThis.VortexGitControlCore;
  const container = document.getElementById("bindings");
  const status = document.getElementById("status");
  let settings = core.defaultSettings();
  let recording = null;
  let recordedKeys = [];

  function sequenceMarkup(sequence) {
    if (!sequence.length) return "Disabled";
    return sequence.map((key) => `<kbd>${escapeHtml(key)}</kbd>`).join(" then ");
  }

  function escapeHtml(value) {
    const span = document.createElement("span");
    span.textContent = value;
    return span.innerHTML;
  }

  function render(errors = {}) {
    container.replaceChildren();
    for (const action of core.ACTIONS) {
      const row = document.createElement("div");
      row.className = "binding-row";
      row.dataset.action = action.id;
      row.innerHTML = `
        <span class="binding-name">${action.label}</span>
        <span class="sequence">${sequenceMarkup(settings.bindings[action.id])}</span>
        <button type="button" class="record" data-recording="${recording === action.id}">${recording === action.id ? "Press 2 keys…" : "Record"}</button>
        <span>
          <button type="button" class="disable">Disable</button>
          <button type="button" class="restore">Reset</button>
        </span>
        ${errors[action.id] ? `<p class="error">${errors[action.id]}</p>` : ""}`;
      container.append(row);
    }
  }

  container.addEventListener("click", (event) => {
    const row = event.target.closest(".binding-row");
    if (!row) return;
    const id = row.dataset.action;
    if (event.target.closest(".record")) {
      recording = id;
      recordedKeys = [];
    } else if (event.target.closest(".disable")) {
      settings.bindings[id] = [];
      recording = null;
      recordedKeys = [];
    } else if (event.target.closest(".restore")) {
      settings.bindings[id] = [...core.ACTIONS.find((item) => item.id === id).defaults];
      recording = null;
      recordedKeys = [];
    }
    render();
  });

  document.addEventListener("keydown", (event) => {
    if (!recording) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      recording = null;
      recordedKeys = [];
      render();
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.repeat) return;
    const token = core.normalizeToken(event.key);
    if (!token) return;
    recordedKeys.push(token);
    if (recordedKeys.length === 2) {
      settings.bindings[recording] = recordedKeys;
      recording = null;
      recordedKeys = [];
    }
    render();
  }, true);

  document.getElementById("restore-all").addEventListener("click", () => {
    settings = core.defaultSettings();
    recording = null;
    recordedKeys = [];
    render();
    status.textContent = "Defaults restored locally. Save to apply them.";
  });

  document.getElementById("save").addEventListener("click", async () => {
    if (recording || recordedKeys.length) {
      status.textContent = "Finish the two-key recording or press Escape to cancel it.";
      return;
    }
    const validation = core.validateBindings(settings.bindings);
    if (!validation.valid) {
      render(validation.errors);
      status.textContent = "Resolve duplicate or incomplete sequences before saving.";
      return;
    }
    settings = core.sanitizeSettings(settings);
    try {
      await chrome.storage.sync.set({ settings });
      status.textContent = "Saved. Open GitHub tabs update immediately.";
    } catch {
      status.textContent = "Chrome could not save these settings. Try again.";
    }
  });

  chrome.storage.sync.get("settings").then(({ settings: stored }) => {
    settings = core.sanitizeSettings(stored);
    render();
  }).catch(() => {
    render();
    status.textContent = "Could not read synced settings; defaults are shown.";
  });
})();
