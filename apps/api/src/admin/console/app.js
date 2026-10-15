(function () {
  "use strict";

  var TOKEN_KEY = "campus_mod_token";
  var PAGE = 25;
  var PREVIEW_CHARS = 240;

  var root = document.getElementById("app");
  var token = null;
  var view = "queue";
  var photoUrls = [];
  var statusEl = null;
  var mainEl = null;

  try {
    token = window.sessionStorage.getItem(TOKEN_KEY);
  } catch (e) {
    token = null;
  }

  function el(tag, props, kids) {
    var node = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "text") node.textContent = String(v);
      else if (k === "class") node.className = String(v);
      else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function fmt(iso) {
    return iso ? String(iso).slice(0, 16).replace("T", " ") + " UTC" : "";
  }

  function rel(iso) {
    var ms = new Date(iso).getTime() - Date.now();
    var abs = Math.abs(ms);
    var n;
    var unit;
    if (abs < 3600000) {
      n = Math.max(1, Math.round(abs / 60000));
      unit = "min";
    } else if (abs < 172800000) {
      n = Math.round(abs / 3600000);
      unit = "h";
    } else {
      n = Math.round(abs / 86400000);
      unit = "days";
    }
    return ms >= 0 ? "in " + n + " " + unit : n + " " + unit + " ago";
  }

  function announce(message) {
    if (statusEl) statusEl.textContent = message;
  }

  function saveToken(t) {
    token = t;
    try {
      if (t) window.sessionStorage.setItem(TOKEN_KEY, t);
      else window.sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      /* storage unavailable: the token stays in memory for this tab */
    }
  }

  function clearPhotos() {
    photoUrls.forEach(function (u) {
      try {
        URL.revokeObjectURL(u);
      } catch (e) {
        /* nothing to revoke */
      }
    });
    photoUrls = [];
  }

  function fail(res, body) {
    var err = new Error((body && body.message) || "Something went wrong.");
    err.status = res.status;
    err.code = body && body.error;
    return err;
  }

  async function call(method, path, payload) {
    var headers = { authorization: "Bearer " + token };
    var init = { method: method, headers: headers, cache: "no-store" };
    if (payload !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(payload);
    }
    var res = await fetch(path, init);
    var text = await res.text();
    var body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (e) {
      body = null;
    }
    if (res.status === 401) {
      saveToken(null);
      var err = fail(res, body);
      err.signedOut = true;
      throw err;
    }
    if (!res.ok) throw fail(res, body);
    return body;
  }

  function alertBox(message) {
    return el("div", { class: "alert", role: "alert", text: message });
  }

  function handle(err, into) {
    if (err && err.signedOut) {
      renderLogin("Your session ended. Enter a moderator token to continue.");
      return;
    }
    var msg = err && err.message ? err.message : "Something went wrong.";
    if (into) {
      into.querySelectorAll("[data-error]").forEach(function (n) {
        n.remove();
      });
      var box = alertBox(msg);
      box.setAttribute("data-error", "");
      into.prepend(box);
    }
    announce(msg);
  }

  function setView(name) {
    view = name;
    clearPhotos();
    renderShell();
  }

  function focusMain() {
    var h = mainEl && mainEl.querySelector("h2");
    if (h) {
      h.setAttribute("tabindex", "-1");
      h.focus();
    }
  }

  /* ------------------------------------------------------------ sign in */

  function renderLogin(message) {
    clearPhotos();
    root.textContent = "";
    var input = el("input", { type: "password", id: "token", autocomplete: "off", spellcheck: "false", required: true });
    var holder = el("div", { class: "wrap" });
    var form = el(
      "form",
      {
        class: "card",
        onsubmit: async function (ev) {
          ev.preventDefault();
          var value = input.value.trim();
          if (!value) return;
          saveToken(value);
          try {
            await call("GET", "/admin/queue?limit=1&offset=0");
            input.value = "";
            view = "queue";
            renderShell();
          } catch (e) {
            saveToken(null);
            handle(e && e.signedOut ? new Error("That token was not recognised.") : e, form);
          }
        },
      },
      [
        el("h1", { text: "Moderation console" }),
        message ? el("p", { class: "warnbox", text: message }) : null,
        el("label", { for: "token" }, ["Moderator token", input]),
        el("button", { class: "primary", type: "submit", text: "Sign in" }),
        el("p", { class: "muted", text: "Tokens are issued by the operator. Everything you do here is recorded under your name." }),
      ],
    );
    holder.appendChild(form);
    root.appendChild(holder);
    input.focus();
  }

  /* ------------------------------------------------------------ shell */

  function renderShell() {
    root.textContent = "";
    statusEl = el("p", { class: "muted", role: "status", "aria-live": "polite" });
    mainEl = el("main", { id: "main" });

    function navButton(name, label) {
      return el("button", {
        type: "button",
        text: label,
        "aria-current": view === name ? "page" : null,
        onclick: function () {
          setView(name);
        },
      });
    }

    var bar = el("header", { class: "bar" }, [
      el("h1", { text: "Moderation console" }),
      el("nav", { "aria-label": "Sections" }, [
        navButton("queue", "Reports"),
        navButton("appeals", "Appeals"),
        el("button", {
          type: "button",
          text: "Sign out",
          onclick: function () {
            saveToken(null);
            renderLogin();
          },
        }),
      ]),
    ]);

    root.appendChild(el("div", { class: "wrap" }, [bar, statusEl, mainEl]));
    if (view === "appeals") showAppeals("open");
    else showQueue();
  }

  /* ------------------------------------------------------------ helpers for people and content */

  function authorLine(p) {
    if (!p) return "Unknown author";
    if (p.authorKind === "anonymous") return "Anonymous profile @" + p.authorHandle;
    return "@" + p.authorHandle + (p.authorDisplayName ? " (" + p.authorDisplayName + ")" : "");
  }

  function reasonsText(reasons) {
    var parts = Object.keys(reasons || {}).map(function (k) {
      return k.replace(/_/g, " ") + " x" + reasons[k];
    });
    return parts.length ? parts.join(", ") : "none";
  }

  function kindLabel(kind) {
    return kind === "post" ? "Post" : kind === "comment" ? "Comment" : "Profile";
  }

  /* ------------------------------------------------------------ queue */

  async function showQueue(offset) {
    var start = offset || 0;
    var list = start === 0 ? el("ul", { class: "list" }) : mainEl.querySelector("ul.list");
    if (start === 0) {
      mainEl.textContent = "";
      mainEl.appendChild(el("h2", { text: "Reports waiting for review" }));
      mainEl.appendChild(el("p", { class: "muted", text: "Urgent and overdue items come first." }));
      mainEl.appendChild(list);
    }
    var more = mainEl.querySelector("[data-more]");
    if (more) more.remove();

    announce("Loading reports");
    var data;
    try {
      data = await call("GET", "/admin/queue?limit=" + PAGE + "&offset=" + start);
    } catch (e) {
      handle(e, mainEl);
      return;
    }
    var items = data.items || [];
    if (start === 0 && items.length === 0) {
      list.replaceWith(el("p", { text: "Nothing to review. The queue is empty." }));
      announce("The queue is empty");
      return;
    }
    items.forEach(function (it) {
      list.appendChild(queueCard(it));
    });
    announce(items.length + " items loaded");
    if (items.length === PAGE) {
      mainEl.appendChild(
        el("button", {
          type: "button",
          "data-more": "",
          text: "Load more",
          onclick: function () {
            showQueue(start + PAGE);
          },
        }),
      );
    }
    if (start === 0) focusMain();
  }

  function queueCard(it) {
    var p = it.preview;
    var tags = [el("span", { class: "tag", text: kindLabel(it.targetKind) })];
    if (it.urgent) tags.unshift(el("span", { class: "tag urgent", text: "Urgent" }));
    if (it.overdue) tags.unshift(el("span", { class: "tag overdue", text: "Overdue" }));
    if (p && p.hidden) tags.push(el("span", { class: "tag", text: "Hidden" }));
    if (p && p.deleted) tags.push(el("span", { class: "tag", text: "Deleted by author" }));

    var text = p && p.text ? (p.text.length > PREVIEW_CHARS ? p.text.slice(0, PREVIEW_CHARS) + "..." : p.text) : null;
    var who = authorLine(p);
    return el("li", { class: "card" }, [
      el("div", { class: "row" }, tags),
      el("p", { class: "muted", text: who }),
      text !== null ? el("p", { class: "content", text: text }) : null,
      el("p", {
        text:
          it.userReports + " report" + (it.userReports === 1 ? "" : "s") +
          ", " + it.autoFlags + " automatic flag" + (it.autoFlags === 1 ? "" : "s") +
          ". Reasons: " + reasonsText(it.reasons) + ".",
      }),
      el("p", { class: "muted", text: "First reported " + fmt(it.oldestReportAt) + ". Due " + fmt(it.dueAt) + " (" + rel(it.dueAt) + ")." }),
      el("button", {
        type: "button",
        class: "primary",
        text: "Review",
        "aria-label": "Review " + kindLabel(it.targetKind).toLowerCase() + " by " + who,
        onclick: function () {
          showTarget(it.targetKind, it.targetId);
        },
      }),
    ]);
  }

  /* ------------------------------------------------------------ one reported item */

  async function showTarget(kind, id) {
    clearPhotos();
    mainEl.textContent = "";
    announce("Loading");
    var t;
    try {
      t = await call("GET", "/admin/targets/" + encodeURIComponent(kind) + "/" + encodeURIComponent(id));
    } catch (e) {
      handle(e, mainEl);
      mainEl.appendChild(backButton());
      return;
    }
    announce("");
    var p = t.preview;
    mainEl.appendChild(backButton());
    mainEl.appendChild(el("h2", { text: kindLabel(t.targetKind) + " by " + authorLine(p) }));

    var state = [];
    if (p.hidden) state.push("hidden" + (p.hiddenReason ? " (" + p.hiddenReason.replace(/_/g, " ") + ")" : ""));
    if (p.deleted) state.push("deleted by its author");
    mainEl.appendChild(
      el("section", { class: "card", "aria-label": "Content" }, [
        el("div", { class: "row" }, [
          p.authorKind === "anonymous" ? el("span", { class: "tag anon", text: "Anonymous" }) : el("span", { class: "tag", text: "Known profile" }),
          state.length ? el("span", { class: "tag", text: "Currently " + state.join(", ") }) : null,
        ]),
        p.text !== null && p.text !== undefined ? el("p", { class: "content", text: p.text }) : el("p", { class: "muted", text: "No text." }),
        photoBlock(t.photos),
      ]),
    );

    mainEl.appendChild(reportsBlock(t.reports));
    mainEl.appendChild(actionsBlock(t.actions));
    mainEl.appendChild(resolveForm(t));
    mainEl.appendChild(penaltyForm(t));
    focusMain();
  }

  function backButton() {
    return el("button", {
      type: "button",
      text: "Back to reports",
      onclick: function () {
        setView("queue");
      },
    });
  }

  function photoBlock(photos) {
    if (!photos || photos.length === 0) return null;
    var wrap = el("div", { class: "photos" });
    photos.forEach(function (ph, i) {
      var img = el("img", { alt: ph.altText ? ph.altText : "Photo " + (i + 1) + " (no description written by the author)", width: ph.width, height: ph.height });
      var caption = el("p", { class: "muted", text: ph.altText ? "Author's description: " + ph.altText : "No description written by the author." });
      wrap.appendChild(el("figure", { class: "photo" }, [img, caption]));
      fetch("/admin/photos/" + encodeURIComponent(ph.uploadId), { headers: { authorization: "Bearer " + token }, cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("photo unavailable");
          return r.blob();
        })
        .then(function (b) {
          var url = URL.createObjectURL(b);
          photoUrls.push(url);
          img.src = url;
        })
        .catch(function () {
          caption.textContent = "This photo could not be loaded.";
        });
    });
    return wrap;
  }

  function reportsBlock(reports) {
    var items = (reports || []).map(function (r) {
      return el("li", { class: "card" }, [
        el("p", { text: r.reason.replace(/_/g, " ") + " (" + (r.source === "auto" ? "automatic flag" : "student report") + ")" }),
        r.detail ? el("p", { class: "content", text: r.detail }) : null,
        el("p", {
          class: "muted",
          text: "Status: " + r.status + ". Received " + fmt(r.createdAt) + (r.resolvedAt ? ". Resolved " + fmt(r.resolvedAt) + (r.resolvedBy ? " by " + r.resolvedBy : "") : "") + ".",
        }),
      ]);
    });
    return el("section", { "aria-label": "Reports" }, [
      el("h3", { text: "Reports (" + items.length + ")" }),
      items.length ? el("ul", { class: "list" }, items) : el("p", { class: "muted", text: "No reports." }),
    ]);
  }

  function actionsBlock(actions) {
    if (!actions || actions.length === 0) return el("section", { "aria-label": "Earlier actions" }, [el("h3", { text: "Earlier actions" }), el("p", { class: "muted", text: "None yet." })]);
    return el("section", { "aria-label": "Earlier actions" }, [
      el("h3", { text: "Earlier actions" }),
      el(
        "ul",
        { class: "list" },
        actions.map(function (a) {
          return el("li", { class: "card" }, [
            el("p", { text: a.kind.replace(/_/g, " ") + " by " + a.moderator + ", " + fmt(a.createdAt) }),
            a.note ? el("p", { class: "content", text: a.note }) : null,
          ]);
        }),
      ),
    ]);
  }

  /* ------------------------------------------------------------ two step confirmation */

  function withConfirm(form, describe, run, confirmLabel, danger) {
    var slot = el("div");
    var submit = el("button", { type: "submit", class: danger ? "danger" : "primary", text: confirmLabel });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var problem = describe.validate();
      slot.textContent = "";
      if (problem) {
        slot.appendChild(alertBox(problem));
        return;
      }
      var yes = el("button", {
        type: "button",
        class: danger ? "danger" : "primary",
        text: "Yes, " + confirmLabel.toLowerCase(),
        onclick: async function () {
          yes.disabled = true;
          no.disabled = true;
          try {
            await run();
          } catch (e) {
            yes.disabled = false;
            no.disabled = false;
            slot.textContent = "";
            slot.appendChild(alertBox(e && e.message ? e.message : "Something went wrong."));
            if (e && e.signedOut) renderLogin("Your session ended. Enter a moderator token to continue.");
          }
        },
      });
      var no = el("button", {
        type: "button",
        text: "Cancel",
        onclick: function () {
          slot.textContent = "";
        },
      });
      slot.appendChild(
        el("div", { class: "warnbox", role: "alert" }, [
          el("p", { text: describe.summary() }),
          el("div", { class: "row" }, [yes, no]),
        ]),
      );
      yes.focus();
    });
    form.appendChild(submit);
    form.appendChild(slot);
  }

  function radio(name, value, label, checked) {
    var id = name + "-" + value;
    return el("div", { class: "choice" }, [
      el("input", { type: "radio", name: name, value: value, id: id, checked: checked }),
      el("label", { for: id, text: label }),
    ]);
  }

  function checkedValue(form, name) {
    var n = form.querySelector('input[name="' + name + '"]:checked');
    return n ? n.value : null;
  }

  function resolveForm(t) {
    var form = el("form", { class: "card", "aria-label": "Resolve reports" });
    var note = el("textarea", { id: "resolve-note", maxlength: "1000" });
    form.appendChild(el("h3", { text: "Resolve the reports" }));
    form.appendChild(
      el("fieldset", {}, [
        el("legend", { text: "Outcome" }),
        radio("outcome", "uphold", "Uphold: the content breaks the rules. Keep it hidden and mark the reports as actioned.", false),
        radio("outcome", "dismiss", "Dismiss: the content is fine. Close the reports, and restore it if it was hidden only because of report volume.", false),
      ]),
    );
    form.appendChild(el("label", { for: "resolve-note" }, ["Note for the record (optional)", note]));
    withConfirm(
      form,
      {
        validate: function () {
          return checkedValue(form, "outcome") ? null : "Choose an outcome first.";
        },
        summary: function () {
          var o = checkedValue(form, "outcome");
          return o === "uphold"
            ? "This closes the reports as actioned and keeps the content hidden. It cannot be undone from here."
            : "This dismisses the reports. Content hidden only because of report volume is shown again.";
        },
      },
      async function () {
        var out = await call("POST", "/admin/targets/" + encodeURIComponent(t.targetKind) + "/" + encodeURIComponent(t.targetId) + "/resolve", {
          outcome: checkedValue(form, "outcome"),
          note: note.value.trim() || null,
        });
        view = "queue";
        renderShell();
        announce("Resolved. " + out.reportsClosed + " report" + (out.reportsClosed === 1 ? "" : "s") + " closed.");
      },
      "Resolve",
      false,
    );
    return form;
  }

  function penaltyForm(t) {
    var p = t.preview;
    var form = el("form", { class: "card", "aria-label": "Penalise the author" });
    var ends = el("input", { type: "datetime-local", id: "pen-ends" });
    var note = el("textarea", { id: "pen-note", maxlength: "1000" });
    var endsLabel = el("label", { for: "pen-ends" }, ["Suspension ends (your local time, between 1 hour and 30 days from now)", ends]);
    endsLabel.hidden = true;

    form.appendChild(el("h3", { text: "Penalise the author" }));
    if (p.authorKind === "anonymous") {
      form.appendChild(
        el("p", {
          class: "warnbox",
          text: "This is an anonymous profile. A penalty applies to the verified account behind it, and you will not see who that is.",
        }),
      );
    }
    var kinds = el("fieldset", {}, [
      el("legend", { text: "Penalty" }),
      radio("kind", "warning", "Warning: recorded against the account. Locks anonymous posting while it counts.", false),
      radio("kind", "suspension", "Suspension: cannot post for a set time.", false),
      radio("kind", "ban", "Ban: the account is closed and its content hidden. The student can appeal once.", false),
    ]);
    kinds.addEventListener("change", function () {
      endsLabel.hidden = checkedValue(form, "kind") !== "suspension";
    });
    form.appendChild(kinds);
    form.appendChild(endsLabel);
    form.appendChild(el("label", { for: "pen-note" }, ["Reason (required, at least 10 characters, kept in the record)", note]));

    withConfirm(
      form,
      {
        validate: function () {
          var k = checkedValue(form, "kind");
          if (!k) return "Choose a penalty first.";
          if (note.value.trim().length < 10) return "Write a reason of at least 10 characters.";
          if (k === "suspension") {
            if (!ends.value) return "Choose when the suspension ends.";
            var ms = new Date(ends.value).getTime() - Date.now();
            if (!(ms > 3600000 && ms <= 30 * 86400000)) return "A suspension must last between 1 hour and 30 days.";
          }
          return null;
        },
        summary: function () {
          var k = checkedValue(form, "kind");
          var who = authorLine(p);
          if (k === "ban") return "This bans the account behind " + who + " and hides everything it posted. This is the strongest action available.";
          if (k === "suspension") return "This suspends the account behind " + who + " until " + fmt(new Date(ends.value).toISOString()) + ".";
          return "This records a warning against the account behind " + who + ".";
        },
      },
      async function () {
        var k = checkedValue(form, "kind");
        var body = { kind: k, note: note.value.trim() };
        if (k === "suspension") body.endsAt = new Date(ends.value).toISOString();
        await call("POST", "/admin/profiles/" + encodeURIComponent(p.authorProfileId) + "/penalties", body);
        form.textContent = "";
        form.appendChild(el("p", { class: "notice", role: "status", text: "The " + k + " has been applied and recorded." }));
        announce("Penalty applied");
      },
      "Apply penalty",
      true,
    );
    form.addEventListener("change", function () {
      var slot = form.lastElementChild;
      if (slot && slot.tagName === "DIV") slot.textContent = "";
    });
    return form;
  }

  /* ------------------------------------------------------------ appeals */

  async function showAppeals(status) {
    clearPhotos();
    mainEl.textContent = "";
    mainEl.appendChild(el("h2", { text: "Appeals" }));
    var picker = el("div", { class: "row", role: "group", "aria-label": "Show appeals that are" });
    ["open", "upheld", "denied"].forEach(function (s) {
      picker.appendChild(
        el("button", {
          type: "button",
          text: s.charAt(0).toUpperCase() + s.slice(1),
          "aria-current": s === status ? "true" : null,
          onclick: function () {
            showAppeals(s);
          },
        }),
      );
    });
    mainEl.appendChild(picker);
    announce("Loading appeals");
    var data;
    try {
      data = await call("GET", "/admin/appeals?status=" + encodeURIComponent(status));
    } catch (e) {
      handle(e, mainEl);
      return;
    }
    var items = data.items || [];
    if (items.length === 0) {
      mainEl.appendChild(el("p", { text: "No " + status + " appeals." }));
      announce("No " + status + " appeals");
      focusMain();
      return;
    }
    var list = el("ul", { class: "list" });
    items.forEach(function (a) {
      list.appendChild(appealCard(a));
    });
    mainEl.appendChild(list);
    announce(items.length + " appeals");
    focusMain();
  }

  function appealCard(a) {
    var card = el("li", { class: "card" }, [
      el("div", { class: "row" }, [el("span", { class: "tag", text: a.status })]),
      el("p", { class: "content", text: a.message || "(No message.)" }),
      el("p", { class: "muted", text: "Received " + fmt(a.createdAt) + "." }),
    ]);
    if (a.status !== "open") {
      card.appendChild(
        el("p", { class: "muted", text: "Decided " + fmt(a.decidedAt) + (a.decidedBy ? " by " + a.decidedBy : "") + (a.decisionNote ? ". Note: " + a.decisionNote : ".") }),
      );
      return card;
    }
    var form = el("form", { "aria-label": "Decide this appeal" });
    var note = el("textarea", { id: "appeal-note-" + a.id, maxlength: "1000" });
    form.appendChild(
      el("fieldset", {}, [
        el("legend", { text: "Decision" }),
        radio("decision-" + a.id, "upheld", "Uphold the appeal: restore the account, its profiles and content.", false),
        radio("decision-" + a.id, "denied", "Deny the appeal: the ban stays. This cannot be reopened.", false),
      ]),
    );
    form.appendChild(el("label", { for: "appeal-note-" + a.id }, ["Reason for your decision (required)", note]));
    withConfirm(
      form,
      {
        validate: function () {
          if (!checkedValue(form, "decision-" + a.id)) return "Choose a decision first.";
          if (note.value.trim().length < 10) return "Write a reason of at least 10 characters.";
          return null;
        },
        summary: function () {
          return checkedValue(form, "decision-" + a.id) === "upheld"
            ? "This restores the student's account and content."
            : "This keeps the ban in place. An appeal can only be decided once.";
        },
      },
      async function () {
        await call("POST", "/admin/appeals/" + encodeURIComponent(a.id) + "/decision", {
          decision: checkedValue(form, "decision-" + a.id),
          note: note.value.trim(),
        });
        showAppeals("open");
        announce("Decision recorded");
      },
      "Record decision",
      true,
    );
    card.appendChild(form);
    return card;
  }

  /* ------------------------------------------------------------ start */

  if (token) renderShell();
  else renderLogin();
})();
