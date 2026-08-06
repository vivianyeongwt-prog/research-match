(() => {
  "use strict";

  const query = new URLSearchParams(window.location.search);
  const suppliedToken = query.get("token");
  if (suppliedToken) sessionStorage.setItem("researchmatch-setup-token", suppliedToken);
  const token = suppliedToken || sessionStorage.getItem("researchmatch-setup-token") || "";
  if (suppliedToken) history.replaceState({}, "", `${location.pathname}${location.hash}`);

  const state = {
    bootstrap: null,
    fieldStates: new Map(),
    busy: false,
    toastTimer: null,
  };

  const byId = (id) => document.getElementById(id);
  const form = byId("setup-form");
  const saveButton = byId("save-button");
  const checkButton = byId("check-button");
  const actionStatus = byId("action-status");
  const statusLight = byId("status-light");

  function element(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(options)) {
      if (key === "className") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key.startsWith("aria-")) node.setAttribute(key, value);
      else node[key] = value;
    }
    for (const child of Array.isArray(children) ? children : [children]) {
      if (child) node.append(child);
    }
    return node;
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("X-Setup-Token", token);
    if (options.body) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({ error: "Setup returned an unreadable response." }));
    if (!response.ok) {
      const error = new Error(payload.error || "Setup could not finish that action.");
      error.fieldErrors = payload.fieldErrors || null;
      throw error;
    }
    return payload;
  }

  function setBusy(busy, message) {
    state.busy = busy;
    saveButton.disabled = busy;
    checkButton.disabled = busy;
    if (message) actionStatus.textContent = message;
  }

  function setStatus(kind, message) {
    statusLight.className = `status-light ${kind || ""}`.trim();
    actionStatus.textContent = message;
  }

  function toast(message) {
    const node = byId("toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
  }

  function fatal(message) {
    byId("fatal-message").textContent = message;
    byId("fatal").classList.remove("is-hidden");
  }

  function storedTransfers() {
    try {
      const parsed = JSON.parse(localStorage.getItem("researchmatch-transfer-checks-v1") || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function updateTransferCount() {
    const checks = [...document.querySelectorAll("[data-transfer-check]")];
    const completed = checks.filter((check) => check.checked).length;
    byId("transfer-count").textContent = `${completed} of ${checks.length}`;
  }

  function renderTransfers(items) {
    const list = byId("transfer-list");
    const stored = storedTransfers();
    for (const item of items) {
      const input = element("input", {
        type: "checkbox",
        checked: Boolean(stored[item.id]),
        dataset: { transferCheck: item.id },
        "aria-label": `Mark ${item.label} as received`,
      });
      input.addEventListener("change", () => {
        const next = storedTransfers();
        next[item.id] = input.checked;
        localStorage.setItem("researchmatch-transfer-checks-v1", JSON.stringify(next));
        updateTransferCount();
      });
      const control = element("label", { className: "check-control" }, [
        input,
        element("span", { className: "check-visual", text: "✓", "aria-hidden": "true" }),
      ]);
      const copy = element("div", { className: "transfer-copy" }, [
        element("strong", { text: item.label }),
        element("span", { text: item.detail }),
      ]);
      const link = element("a", {
        className: "out-link",
        text: "Open ↗",
        href: item.url,
        target: "_blank",
        rel: "noreferrer",
      });
      list.append(element("div", { className: "transfer-item" }, [control, copy, link]));
    }
    updateTransferCount();
  }

  function fieldState(id) {
    return state.fieldStates.get(id) || "missing";
  }

  function stateLabel(value) {
    if (value === "configured") return "Configured";
    if (value === "mismatch") return "Needs update";
    return "Not set";
  }

  function createField(field) {
    const id = `field-${field.id}`;
    const status = fieldState(field.id);
    const label = element("label", { htmlFor: id, text: field.label });
    const stateChip = element("span", {
      className: `field-state ${status}`,
      text: stateLabel(status),
      dataset: { fieldState: field.id },
    });
    const topline = element("div", { className: "field-topline" }, [label, stateChip]);
    const input = element("input", {
      id,
      name: field.id,
      type: field.secret ? "password" : "text",
      placeholder:
        status === "configured" ? "Already configured — leave blank to keep it" : field.placeholder,
      autocomplete: field.secret ? "new-password" : "off",
      spellcheck: false,
      "aria-describedby": `${id}-help ${id}-error`,
    });
    input.addEventListener("input", () => {
      const wrapper = input.closest(".field");
      wrapper.classList.remove("has-error");
      byId(`${id}-error`).textContent = "";
    });
    const shell = element("div", { className: `input-shell${field.secret ? " has-toggle" : ""}` }, [input]);
    if (field.secret) {
      const reveal = element("button", {
        className: "reveal-button",
        type: "button",
        text: "Show",
        "aria-label": `Show ${field.label}`,
      });
      reveal.addEventListener("click", () => {
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        reveal.textContent = showing ? "Show" : "Hide";
        reveal.setAttribute("aria-label", `${showing ? "Show" : "Hide"} ${field.label}`);
      });
      shell.append(reveal);
    }
    const help = element("p", { className: "field-help", id: `${id}-help` });
    help.append(document.createTextNode(field.description));
    if (field.helpUrl) {
      help.append(document.createTextNode(" "));
      help.append(element("a", {
        text: "Get it ↗",
        href: field.helpUrl,
        target: "_blank",
        rel: "noreferrer",
      }));
    }
    const error = element("p", { className: "field-error", id: `${id}-error` });
    return element("div", { className: "field" }, [topline, shell, help, error]);
  }

  function renderNavigation(groups) {
    const nav = byId("section-nav");
    const links = [
      { id: "transfer", title: "Ownership transfers", complete: false },
      ...groups.map((group) => ({ id: group.id, title: group.title, complete: groupComplete(group.id) })),
      { id: "finish", title: "Verify & deploy", complete: false },
    ];
    nav.replaceChildren();
    for (const item of links) {
      nav.append(element("a", {
        href: `#${item.id}`,
        className: item.complete ? "is-complete" : "",
        dataset: { navGroup: item.id },
      }, [
        element("span", { className: "nav-dot", "aria-hidden": "true" }),
        element("span", { text: item.title }),
      ]));
    }
  }

  function groupComplete(groupId) {
    const fields = state.bootstrap.fields.filter((field) => field.group === groupId && field.level === "required");
    return fields.length === 0 || fields.every((field) => fieldState(field.id) === "configured");
  }

  function renderSections(groups, fields) {
    const parent = byId("setup-sections");
    parent.replaceChildren();
    for (const group of groups) {
      const groupFields = fields.filter((field) => field.group === group.id);
      const regular = groupFields.filter((field) => !field.advanced);
      const advanced = groupFields.filter((field) => field.advanced);
      const heading = element("div", { className: "section-heading" }, [
        element("div", {}, [
          element("p", { className: "eyebrow", text: group.eyebrow }),
          element("h2", { text: group.title }),
        ]),
      ]);
      const grid = element("div", { className: "fields" });
      for (const field of regular) grid.append(createField(field));
      if (advanced.length > 0) {
        const details = element("details", { className: "advanced-fields" });
        details.append(element("summary", { text: "Advanced options" }));
        const advancedGrid = element("div", { className: "advanced-grid" });
        for (const field of advanced) advancedGrid.append(createField(field));
        details.append(advancedGrid);
        grid.append(details);
      }
      parent.append(element("section", {
        className: "setup-section",
        id: group.id,
        "aria-labelledby": `${group.id}-title`,
      }, [
        heading,
        element("p", { className: "section-description", text: group.description }),
        grid,
      ]));
      heading.querySelector("h2").id = `${group.id}-title`;
    }
  }

  function applyStatus(status) {
    state.fieldStates = new Map(status.fields.map((field) => [field.id, field.state]));
    for (const field of status.fields) {
      const chip = document.querySelector(`[data-field-state="${CSS.escape(field.id)}"]`);
      if (chip) {
        chip.className = `field-state ${field.state}`;
        chip.textContent = stateLabel(field.state);
      }
      const input = form.elements.namedItem(field.id);
      const definition = state.bootstrap.fields.find((candidate) => candidate.id === field.id);
      if (input && definition) {
        input.placeholder =
          field.state === "configured"
            ? "Already configured — leave blank to keep it"
            : definition.placeholder;
      }
    }
    const percent = status.requiredTotal
      ? Math.round((status.requiredConfigured / status.requiredTotal) * 100)
      : 100;
    byId("progress-number").textContent = String(percent);
    byId("progress-orb").style.setProperty("--progress", `${percent * 3.6}deg`);
    if (status.ready) setStatus("ready", "Core credentials are configured");
    else setStatus("waiting", `${status.requiredTotal - status.requiredConfigured} required items left`);
    renderNavigation(state.bootstrap.groups);
  }

  function formValues() {
    const values = {};
    for (const field of state.bootstrap.fields) {
      const input = form.elements.namedItem(field.id);
      if (input && input.value.trim()) values[field.id] = input.value;
    }
    return values;
  }

  function clearFieldErrors() {
    document.querySelectorAll(".field.has-error").forEach((node) => node.classList.remove("has-error"));
    document.querySelectorAll(".field-error").forEach((node) => { node.textContent = ""; });
  }

  function showFieldErrors(errors) {
    clearFieldErrors();
    let first = null;
    for (const [id, message] of Object.entries(errors || {})) {
      const input = form.elements.namedItem(id);
      if (!input) continue;
      const field = input.closest(".field");
      field.classList.add("has-error");
      byId(`field-${id}-error`).textContent = message;
      first ||= input;
    }
    first?.focus();
  }

  function showAudit(audit) {
    const card = byId("audit-card");
    card.classList.remove("is-hidden");
    byId("audit-output").textContent = audit.output;
    const result = byId("audit-result");
    result.className = `audit-result ${audit.ok ? "pass" : "fail"}`;
    result.textContent = audit.ok ? "Passed" : "Needs attention";
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save(event) {
    event.preventDefault();
    if (state.busy) return;
    clearFieldErrors();
    setBusy(true, "Saving privately and checking…");
    setStatus("waiting", "Saving privately and checking…");
    try {
      const payload = await api("/api/save", {
        method: "POST",
        body: JSON.stringify({ values: formValues() }),
      });
      for (const field of state.bootstrap.fields) {
        const input = form.elements.namedItem(field.id);
        if (input) input.value = "";
      }
      applyStatus(payload.status);
      showAudit(payload.audit);
      toast(payload.backup ? "Saved. Your previous configuration was backed up." : "Private configuration saved.");
    } catch (error) {
      if (error.fieldErrors) showFieldErrors(error.fieldErrors);
      setStatus("error", error.message);
      toast(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (state.busy) return;
    setBusy(true, "Running the secret-safe check…");
    setStatus("waiting", "Running the secret-safe check…");
    try {
      const payload = await api("/api/check", { method: "POST", body: "{}" });
      applyStatus(payload.status);
      showAudit(payload.audit);
    } catch (error) {
      setStatus("error", error.message);
      toast(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyCommand(targetId) {
    const target = byId(targetId);
    if (!target) return;
    const command = target.textContent;
    try {
      await navigator.clipboard.writeText(command);
      toast("Command copied.");
    } catch {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      toast("Command selected—press Copy.");
    }
  }

  async function closeSetup() {
    if (state.busy) return;
    try {
      await api("/api/shutdown", { method: "POST", body: "{}" });
      document.body.innerHTML = "";
      const closed = element("main", { className: "fatal" }, [
        element("div", { className: "fatal-card" }, [
          element("div", { className: "note-icon", text: "✓", "aria-hidden": "true" }),
          element("h1", { text: "Setup closed." }),
          element("p", { text: "Your private configuration is saved. You can close this tab." }),
        ]),
      ]);
      document.body.append(closed);
    } catch (error) {
      toast(error.message);
    }
  }

  async function start() {
    if (!token) {
      fatal("The private setup token is missing. Restart npm run buyer:setup and open its new link.");
      return;
    }
    try {
      const bootstrap = await api("/api/bootstrap");
      state.bootstrap = bootstrap;
      state.fieldStates = new Map(bootstrap.status.fields.map((field) => [field.id, field.state]));
      renderTransfers(bootstrap.transferChecklist);
      renderSections(bootstrap.groups, bootstrap.fields);
      renderNavigation(bootstrap.groups);
      applyStatus(bootstrap.status);
      byId("vercel-help").textContent = bootstrap.vercelLinked
        ? "This checkout is linked to Vercel. The command updates Production without printing secret values."
        : "Run npx vercel link once first, then use the command above to update Production.";
      form.addEventListener("submit", save);
      checkButton.addEventListener("click", check);
      document.querySelectorAll("[data-copy-target]").forEach((button) => {
        button.addEventListener("click", () => copyCommand(button.dataset.copyTarget));
      });
      byId("close-button").addEventListener("click", closeSetup);
    } catch (error) {
      fatal(error.message);
    }
  }

  start();
})();
