/* ============================================================
   BG Informatique — shared interactions
   Every page loads this one file. Each module is guarded by
   feature detection, so it only runs where its markup exists.
   ============================================================ */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Mobile navigation ──────────────────────────────────── */
  (function mobileNav() {
    var toggle = document.querySelector(".nav-toggle");
    var menu = document.getElementById("mobile-nav");
    if (!toggle || !menu) return;
    toggle.addEventListener("click", function () {
      var open = menu.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
      toggle.textContent = open ? "✕" : "☰";
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        menu.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "☰";
      }
    });
  })();

  /* ── Generic accordion (FAQ) — single open per group ────── */
  (function accordion() {
    var triggers = document.querySelectorAll(".accordion-trigger");
    if (!triggers.length) return;
    triggers.forEach(function (btn) {
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", function () {
        var item = btn.closest(".accordion-item");
        if (!item) return;
        var group = item.closest(".accordion");
        var willOpen = !item.classList.contains("is-open");
        if (group) {
          group.querySelectorAll(".accordion-item.is-open").forEach(function (other) {
            if (other !== item) {
              other.classList.remove("is-open");
              var t = other.querySelector(".accordion-trigger");
              if (t) t.setAttribute("aria-expanded", "false");
            }
          });
        }
        item.classList.toggle("is-open", willOpen);
        btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
      });
    });
  })();

  /* ── Scroll reveal ──────────────────────────────────────── */
  (function reveal() {
    var els = document.querySelectorAll(".reveal");
    if (!els.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry, i) {
        if (entry.isIntersecting) {
          var el = entry.target;
          setTimeout(function () { el.classList.add("is-visible"); }, i * 80);
          io.unobserve(el);
        }
      });
    }, { threshold: 0.14 });
    els.forEach(function (el) { io.observe(el); });
  })();

  /* ── Hero terminal typing animation ─────────────────────── */
  (function terminalAnim() {
    var term = document.querySelector(".terminal--anim");
    if (!term) return;
    var cmdEl = term.querySelector(".terminal-cmd");
    var lines = term.querySelectorAll(".terminal-line");
    var prompt = term.querySelector(".terminal-prompt");
    if (reduceMotion) return; // CSS keeps everything visible
    term.classList.add("is-animating");
    if (prompt) prompt.style.opacity = "0";

    var cmd = cmdEl ? (cmdEl.getAttribute("data-cmd") || cmdEl.textContent) : "";
    if (cmdEl) cmdEl.textContent = "";
    var caret = document.createElement("span");
    caret.className = "caret";
    if (cmdEl) cmdEl.appendChild(caret);

    var i = 0, n = 0;
    function typeCmd() {
      i++;
      if (cmdEl) cmdEl.textContent = cmd.slice(0, i);
      if (cmdEl) cmdEl.appendChild(caret);
      if (i < cmd.length) { setTimeout(typeCmd, 52); }
      else { if (cmdEl) cmdEl.removeChild(caret); setTimeout(revealLine, 240); }
    }
    function revealLine() {
      if (n < lines.length) {
        lines[n].style.opacity = "1";
        n++;
        setTimeout(revealLine, 220);
      } else if (prompt) {
        prompt.style.opacity = "1";
      }
    }
    if (cmd) setTimeout(typeCmd, 450); else revealLine();
  })();

  /* ── Help centre : guide accordion + search + filter ────── */
  (function helpCentre() {
    var list = document.getElementById("guide-list");
    if (!list) return;
    var guides = Array.prototype.slice.call(list.querySelectorAll(".guide"));
    var search = document.getElementById("guide-search");
    var chips = Array.prototype.slice.call(document.querySelectorAll(".chip[data-cat]"));
    var empty = document.getElementById("guides-empty");
    var emptyQuery = document.getElementById("guides-empty-query");
    var activeCat = "all";

    guides.forEach(function (g) {
      var trigger = g.querySelector(".guide-trigger");
      if (!trigger) return;
      trigger.setAttribute("aria-expanded", "false");
      trigger.addEventListener("click", function () {
        var open = g.classList.toggle("is-open");
        trigger.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });

    function apply() {
      var q = (search && search.value ? search.value : "").trim().toLowerCase();
      var shown = 0;
      guides.forEach(function (g) {
        var catOk = activeCat === "all" || g.getAttribute("data-cat") === activeCat;
        var text = (g.getAttribute("data-text") || g.textContent).toLowerCase();
        var qOk = !q || text.indexOf(q) !== -1;
        var visible = catOk && qOk;
        g.classList.toggle("is-hidden", !visible);
        if (visible) shown++;
      });
      if (empty) {
        empty.style.display = shown === 0 ? "" : "none";
        if (emptyQuery) emptyQuery.textContent = q || "…";
      }
    }

    if (search) search.addEventListener("input", apply);
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chips.forEach(function (c) { c.classList.remove("is-active"); });
        chip.classList.add("is-active");
        activeCat = chip.getAttribute("data-cat");
        apply();
      });
    });
    apply();
  })();

  /* ── Code copy buttons (tool page) ──────────────────────── */
  (function codeCopy() {
    var btns = document.querySelectorAll(".code-copy");
    if (!btns.length) return;
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var txt = btn.getAttribute("data-copy") ||
          (btn.nextElementSibling && btn.nextElementSibling.textContent) || "";
        navigator.clipboard.writeText(txt).then(function () {
          var original = btn.textContent;
          btn.textContent = "✓ Copié";
          btn.classList.add("copied");
          setTimeout(function () { btn.textContent = original; btn.classList.remove("copied"); }, 2000);
        }).catch(function () {
          btn.textContent = "Erreur";
          setTimeout(function () { btn.textContent = "Copier"; }, 2000);
        });
      });
    });
  })();

  /* ── Contact form (Formspree) ───────────────────────────── */
  (function contactForm() {
    var form = document.getElementById("contact-form");
    if (!form) return;
    var statusEl = document.getElementById("form-status");
    var submitBtn = form.querySelector(".form-submit");
    var submitLabel = submitBtn ? submitBtn.textContent : "";

    function setStatus(msg, kind) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.className = "form-status" + (kind ? " is-" + kind : "");
      statusEl.style.display = msg ? "" : "none";
    }
    setStatus("", "");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var required = form.querySelectorAll("[required]");
      var valid = true;
      required.forEach(function (el) {
        if (!String(el.value || "").trim()) { if (valid) el.focus(); valid = false; }
      });
      if (!valid) { setStatus("Veuillez remplir les champs obligatoires.", "error"); return; }

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Envoi en cours…"; }
      setStatus("", "");

      fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { "Accept": "application/json" }
      }).then(function (res) {
        if (res.ok) {
          form.reset();
          setStatus("✓ Message envoyé ! On vous répond dans les meilleurs délais.", "success");
        } else { throw new Error("server"); }
      }).catch(function () {
        setStatus("⚠ Une erreur est survenue. Appelez-nous au 450 231-9199 ou écrivez à information@bginformatique.ca.", "error");
      }).then(function () {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel; }
      });
    });
  })();

  /* ── Diagnostic wizard ──────────────────────────────────── */
  (function wizard() {
    var root = document.getElementById("wizard");
    if (!root) return;

    var FORMSPREE = "https://formspree.io/f/mnjrkalw";

    var state = {
      clientType: null,
      r_problem: null, r_duration: null, r_os: null,
      b_challenge: null, b_size: null, b_urgency: null,
      summary: "", subject: "", message: ""
    };

    var labels = {
      slow: "PC lent", crash: "Plantages ou ne démarre plus",
      virus: "Virus ou malware suspecté", reinstall: "Réinstallation ou sauvegarde",
      network: "Problème réseau ou WiFi", "other-r": "Autre problème logiciel",
      today: "Aujourd'hui ou hier", days: "Quelques jours",
      weeks: "Plusieurs semaines ou plus", unknown: "Je ne sais pas",
      win11: "Windows 11", win10: "Windows 10",
      winold: "Windows (version plus ancienne)", macos: "macOS", "unknown-os": "Système inconnu",
      automation: "Automatisation de tâches répétitives",
      security: "Cybersécurité et protection des données",
      cloud: "Infrastructure cloud ou serveurs",
      ai: "Intelligence artificielle",
      m365: "Microsoft 365 et gouvernance",
      "other-b": "Autre / Je ne sais pas encore",
      solo: "Travailleur autonome", small: "2 à 10 employés",
      medium: "11 à 50 employés", large: "50 employés et plus",
      urgent: "Urgent — impact sur les opérations maintenant",
      planned: "Planifié — projet à mettre en place",
      exploring: "Exploration — je magasine des options"
    };

    var businessRecs = {
      automation: { name: "Automatisation des processus d'affaires", desc: "Scripts Python/Bash sur mesure, intégration d'API et outils internes pour éliminer vos tâches répétitives.", url: "automatisation-processus-affaires-saint-jerome.html", subject: "Demande d'automatisation de processus" },
      security: { name: "Cybersécurité préventive et formation", desc: "Simulations d'hameçonnage, formation des équipes et sensibilisation — avant qu'un incident ne survienne.", url: "cybersecurite-formation-saint-jerome.html", subject: "Demande en cybersécurité préventive" },
      cloud: { name: "Gestion d'infrastructures cloud et systèmes", desc: "Administration Linux à distance, gouvernance Microsoft 365 avancée et stratégie de sauvegarde BaaS/DRaaS.", url: "infrastructure-cloud-saint-jerome.html", subject: "Demande gestion infrastructure cloud" },
      ai: { name: "Consultation et intégration en intelligence artificielle", desc: "Audit d'opportunités IA, déploiement Microsoft Copilot et formation sur l'utilisation sécuritaire.", url: "consultation-ia-laurentides.html", subject: "Demande de consultation IA" },
      m365: { name: "Gestion d'infrastructures cloud et systèmes", desc: "Gouvernance Microsoft 365 avancée : MFA conditionnel, DLP, politiques de rétention et audit des accès.", url: "infrastructure-cloud-saint-jerome.html", subject: "Demande gouvernance Microsoft 365" },
      "other-b": { name: "Services entreprises BG Informatique", desc: "Consultez notre page complète de services pour trouver la prestation qui correspond à votre situation.", url: "services.html", subject: "Demande de consultation TI" }
    };

    function showStep(id) {
      root.querySelectorAll(".wizard-step").forEach(function (s) { s.classList.remove("is-active"); });
      var el = document.getElementById(id);
      if (el) {
        el.classList.add("is-active");
        var card = root.querySelector(".wizard");
        if (card && card.scrollIntoView) card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
      }
    }

    function bindChoices(stepId, stateKey, onNext, onBack) {
      var step = document.getElementById(stepId);
      if (!step) return;
      var choices = step.querySelectorAll(".wizard-choice");
      var nextBtn = step.querySelector(".wizard-next");
      var backBtn = step.querySelector(".wizard-back");
      choices.forEach(function (btn) {
        btn.addEventListener("click", function () {
          choices.forEach(function (b) {
            b.classList.remove("is-selected");
            b.setAttribute("aria-pressed", "false");
            var m = b.querySelector(".mark"); if (m) m.textContent = "[ ]";
          });
          btn.classList.add("is-selected");
          btn.setAttribute("aria-pressed", "true");
          var m = btn.querySelector(".mark"); if (m) m.textContent = "[•]";
          state[stateKey] = btn.getAttribute("data-value");
          if (nextBtn) nextBtn.disabled = false;
        });
      });
      if (nextBtn) nextBtn.addEventListener("click", function () { if (state[stateKey]) onNext(); });
      if (backBtn) backBtn.addEventListener("click", onBack);
    }

    bindChoices("step-type", "clientType",
      function () { showStep(state.clientType === "residential" ? "step-r1" : "step-b1"); },
      function () {});
    bindChoices("step-r1", "r_problem", function () { showStep("step-r2"); }, function () { showStep("step-type"); });
    bindChoices("step-r2", "r_duration", function () { showStep("step-r3"); }, function () { showStep("step-r1"); });
    bindChoices("step-r3", "r_os", buildResidential, function () { showStep("step-r2"); });
    bindChoices("step-b1", "b_challenge", function () { showStep("step-b2"); }, function () { showStep("step-type"); });
    bindChoices("step-b2", "b_size", function () { showStep("step-b3"); }, function () { showStep("step-b1"); });
    bindChoices("step-b3", "b_urgency", buildBusiness, function () { showStep("step-b2"); });

    function fillSummary(boxId, rows) {
      var box = document.getElementById(boxId);
      if (!box) return;
      box.innerHTML = "";
      var head = document.createElement("div");
      head.className = "sb-cmd";
      head.textContent = "$ cat résumé.txt";
      box.appendChild(head);
      rows.forEach(function (r) {
        var line = document.createElement("div");
        line.className = "sb-line";
        line.innerHTML = '<span class="bullet">•</span> ' + r.k + ' <span class="val"></span>';
        line.querySelector(".val").textContent = r.v;
        box.appendChild(line);
      });
    }

    function buildResidential() {
      var prob = labels[state.r_problem] || state.r_problem;
      var dur = labels[state.r_duration] || state.r_duration;
      var os = labels[state.r_os] || state.r_os;
      state.subject = "Pré-diagnostic résidentiel — BG Informatique";
      state.message =
        "Bonjour,\n\nVoici mon résumé de pré-diagnostic :\n\n" +
        "• Type : Particulier / résidentiel\n" +
        "• Problème : " + prob + "\n" +
        "• Depuis : " + dur + "\n" +
        "• Système : " + os + "\n\n" +
        "[Joignez le fichier Diagnostic-BG_*.txt si vous l'avez généré, ou ajoutez tout détail supplémentaire]";
      fillSummary("summary-residential", [
        { k: "Type ........", v: "Particulier / résidentiel" },
        { k: "Problème ....", v: prob },
        { k: "Depuis ......", v: dur },
        { k: "Système .....", v: os }
      ]);
      setMailto("mailto-residential", state.subject, state.message);
      resetStatus("status-residential", "email-residential");
      showStep("step-result-residential");
    }

    function buildBusiness() {
      var rec = businessRecs[state.b_challenge] || businessRecs["other-b"];
      var chall = labels[state.b_challenge] || state.b_challenge;
      var size = labels[state.b_size] || state.b_size;
      var urgency = labels[state.b_urgency] || state.b_urgency;
      setText("result-service-name", rec.name);
      setText("result-service-desc", rec.desc);
      var link = document.getElementById("result-service-link");
      if (link) link.href = rec.url;
      state.subject = rec.subject;
      state.message =
        "Bonjour,\n\nVoici mon résumé de pré-diagnostic :\n\n" +
        "• Type : Entreprise / OBNL / travailleur autonome\n" +
        "• Défi principal : " + chall + "\n" +
        "• Taille : " + size + "\n" +
        "• Urgence : " + urgency + "\n\n" +
        "[Ajoutez ici tout détail supplémentaire sur votre situation]";
      fillSummary("summary-business", [
        { k: "Type ........", v: "Entreprise / OBNL / autonome" },
        { k: "Défi ........", v: chall },
        { k: "Taille ......", v: size },
        { k: "Urgence .....", v: urgency }
      ]);
      setMailto("mailto-business", state.subject, state.message);
      resetStatus("status-business", "email-business");
      showStep("step-result-business");
    }

    function setText(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; }
    function setMailto(id, subject, message) {
      var el = document.getElementById(id);
      if (el) el.href = "mailto:information@bginformatique.ca?subject=" +
        encodeURIComponent(subject) + "&body=" + encodeURIComponent(message);
    }
    function resetStatus(statusId, emailId) {
      var s = document.getElementById(statusId);
      if (s) { s.textContent = ""; s.className = "wizard-status"; }
      var e = document.getElementById(emailId);
      if (e) e.value = "";
    }

    function submit(emailId, statusId) {
      var emailEl = document.getElementById(emailId);
      var statusEl = document.getElementById(statusId);
      var email = (emailEl && emailEl.value || "").trim();
      if (!email || email.indexOf("@") === -1 || email.indexOf(".") === -1) {
        if (statusEl) { statusEl.textContent = "Veuillez entrer une adresse courriel valide."; statusEl.className = "wizard-status is-error"; }
        if (emailEl) emailEl.focus();
        return;
      }
      if (statusEl) { statusEl.textContent = "Envoi en cours…"; statusEl.className = "wizard-status"; }
      fetch(FORMSPREE, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ email: email, subject: state.subject, message: state.message })
      }).then(function (res) {
        if (res.ok) {
          if (statusEl) { statusEl.textContent = "✓ Reçu ! Nous vous répondons sous peu au " + email + "."; statusEl.className = "wizard-status is-success"; }
          if (emailEl) emailEl.value = "";
        } else { throw new Error("server"); }
      }).catch(function () {
        if (statusEl) { statusEl.textContent = "Échec de l'envoi. Appelez-nous au 450 231-9199 ou écrivez à information@bginformatique.ca."; statusEl.className = "wizard-status is-error"; }
      });
    }

    var subR = document.getElementById("submit-residential");
    if (subR) subR.addEventListener("click", function () { submit("email-residential", "status-residential"); });
    var subB = document.getElementById("submit-business");
    if (subB) subB.addEventListener("click", function () { submit("email-business", "status-business"); });

    root.querySelectorAll(".wizard-restart").forEach(function (btn) {
      btn.addEventListener("click", function () {
        Object.keys(state).forEach(function (k) { state[k] = (typeof state[k] === "string") ? "" : null; });
        root.querySelectorAll(".wizard-choice").forEach(function (b) {
          b.classList.remove("is-selected");
          b.setAttribute("aria-pressed", "false");
          var m = b.querySelector(".mark"); if (m) m.textContent = "[ ]";
        });
        root.querySelectorAll(".wizard-next").forEach(function (b) { b.disabled = true; });
        resetStatus("status-residential", "email-residential");
        resetStatus("status-business", "email-business");
        showStep("step-type");
      });
    });
  })();
})();
