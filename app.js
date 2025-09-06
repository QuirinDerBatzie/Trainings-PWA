/* ============
   Training Log PWA – App Logic (Table History + WebAudio Beeps)
   ============ */

// ---- Storage helpers (LocalStorage) ----
const LS_KEYS = {
  EXERCISES: "tl_exercises",
  TRAININGS: "tl_trainings",
  ROTATION: "tl_rotation",
  LOGS: "tl_logs",
  META: "tl_meta",
};

const loadJSON = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
  catch { return fallback; }
};
const saveJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ---- Default Data ----
function ensureDefaults() {
  const meta = loadJSON(LS_KEYS.META, {});
  if (meta.version === 1) return;

  const exercises = [
    { id: "ex_chest_press", name: "Chest Press", class: "Push", mode: "machine", archived: false },
    { id: "ex_shoulder_press", name: "Shoulder Press", class: "Push", mode: "machine", archived: false },
    { id: "ex_pushups", name: "Push-Ups", class: "Push", mode: "bodyweight", archived: false },
    { id: "ex_band_chest_fly", name: "Band Chest Fly", class: "Push", mode: "band", archived: false },

    { id: "ex_lat_pulldown", name: "Lat Pulldown", class: "Pull", mode: "machine", archived: false },
    { id: "ex_seated_row", name: "Seated Row", class: "Pull", mode: "machine", archived: false },
    { id: "ex_inverted_rows_table", name: "Inverted Rows (Tisch)", class: "Pull", mode: "bodyweight", archived: false },
    { id: "ex_band_rows", name: "Band Rows", class: "Pull", mode: "band", archived: false },

    { id: "ex_leg_press", name: "Leg Press", class: "Legs", mode: "machine", archived: false },
    { id: "ex_leg_curl", name: "Leg Curl", class: "Legs", mode: "machine", archived: false },
    { id: "ex_bulgarian_split_squat", name: "Bulgarian Split Squat", class: "Legs", mode: "bodyweight", archived: false },
    { id: "ex_band_hip_thrust", name: "Band Hip Thrust", class: "Legs", mode: "band", archived: false },

    { id: "ex_ab_crunch_machine", name: "Ab Crunch Machine", class: "Core", mode: "machine", archived: false },
    { id: "ex_rotary_torso", name: "Rotary Torso", class: "Core", mode: "machine", archived: false },
    { id: "ex_band_woodchopper", name: "Band Woodchopper", class: "Core", mode: "band", archived: false },
    { id: "ex_leg_raises_floor", name: "Leg Raises (liegend)", class: "Core", mode: "bodyweight", archived: false },
  ];

  const trainings = [
    { id: "tr_gym1", title: "Gym 1 – Push & Legs", exerciseIds: ["ex_chest_press","ex_shoulder_press","ex_leg_press","ex_leg_curl"] },
    { id: "tr_bbw1", title: "B&BW 1 – Pull & Core", exerciseIds: ["ex_inverted_rows_table","ex_band_rows","ex_band_woodchopper","ex_leg_raises_floor"] },
    { id: "tr_gym2", title: "Gym 2 – Pull & Core", exerciseIds: ["ex_lat_pulldown","ex_seated_row","ex_ab_crunch_machine","ex_rotary_torso"] },
    { id: "tr_bbw2", title: "B&BW 2 – Push & Legs", exerciseIds: ["ex_pushups","ex_band_chest_fly","ex_bulgarian_split_squat","ex_band_hip_thrust"] },
  ];

  const rotation = { t1: "tr_gym1", t2: "tr_bbw1", t3: "tr_gym2", t4: "tr_bbw2" };

  saveJSON(LS_KEYS.EXERCISES, exercises);
  saveJSON(LS_KEYS.TRAININGS, trainings);
  saveJSON(LS_KEYS.ROTATION, rotation);
  saveJSON(LS_KEYS.LOGS, []);
  saveJSON(LS_KEYS.META, { version: 1, createdAt: new Date().toISOString() });
}

// ---- State ----
let state = {
  currentTrainingId: null,
  session: null, // {trainingId, exerciseQueue, done:[], startedAt, results:[]}
  currentExerciseId: null,
  restTimerInterval: null,
  restStartTs: null,
  audioCtx: null, // WebAudio
};

// ---- Utilities ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showScreen(id){
  $$(".screen").forEach(s => s.classList.remove("active"));
  $("#" + id).classList.add("active");
}

function fmtTime(ms){
  const s = Math.floor(ms/1000);
  const m = Math.floor(s/60);
  const ss = s % 60;
  return `${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}

function fmtDate(isoStr){
  const d = new Date(isoStr);
  return d.toLocaleDateString(undefined, { year:"2-digit", month:"2-digit", day:"2-digit" });
}

function todayTrainingIdByDate(date=new Date()){
  const d = date.getDate();
  const rot = loadJSON(LS_KEYS.ROTATION, {});
  if (d >= 1 && d <= 7) return rot.t1;
  if (d >= 8 && d <= 14) return rot.t2;
  if (d >= 15 && d <= 21) return rot.t3;
  return rot.t4;
}

function getTrainingLabel(id){
  const t = loadJSON(LS_KEYS.TRAININGS, []).find(x=>x.id===id);
  return t ? t.title : "–";
}
function getExercise(id){ return loadJSON(LS_KEYS.EXERCISES, []).find(e=>e.id===id); }
function lastLogForExercise(exId){
  const logs = loadJSON(LS_KEYS.LOGS, []);
  for (let i=logs.length-1;i>=0;i--){
    if (logs[i].exerciseId===exId) return logs[i];
  }
  return null;
}

// ---- Dashboard ----
function renderDashboard(){
  const todayId = todayTrainingIdByDate();
  $("#todayTrainingHeading").textContent = "Heute: " + getTrainingLabel(todayId);
  state.currentTrainingId = todayId;

  const override = $("#overrideSelect");
  override.innerHTML = `<option value="">Nein</option>` + loadJSON(LS_KEYS.TRAININGS, [])
    .map(t=>`<option value="${t.id}">${t.title}</option>`).join("");
}
$("#startTrainingBtn").addEventListener("click", ()=>{
  const override = $("#overrideSelect").value;
  const chosen = override || state.currentTrainingId;
  startSession(chosen);
});

// ---- Session / Exercise Picker ----
function startSession(trainingId){
  const t = loadJSON(LS_KEYS.TRAININGS, []).find(x=>x.id===trainingId);
  if (!t){ alert("Training nicht gefunden."); return; }

  state.session = {
    trainingId,
    exerciseQueue: [...t.exerciseIds],
    done: [],
    startedAt: new Date().toISOString(),
    results: [],
  };
  state.restStartTs = Date.now();
  startRestTimer();
  $("#trainingTitle").textContent = t.title;
  renderExercisePicker();
  showScreen("screen-exercise-picker");
}

function renderExercisePicker(){
  const wrap = $("#exerciseButtons");
  wrap.innerHTML = "";
  const { exerciseQueue } = state.session;

  exerciseQueue.forEach(id=>{
    const ex = getExercise(id);
    const btn = document.createElement("button");
    btn.className = "primary-btn";
    btn.textContent = ex?.name ?? id;
    btn.addEventListener("click", ()=> openExercise(id));
    wrap.appendChild(btn);
  });

  if (state.session.exerciseQueue.length === 0){
    $("#allDone").classList.remove("hidden");
    const s = $("#sessionSummary");
    s.innerHTML = state.session.results.map(r=>(
      `<div class="row">
        <span class="pill">${r.name}</span>
        <span class="pill">${r.load||"—"}</span>
        <span class="pill">${r.difficulty}</span>
      </div>`
    )).join("");
  } else {
    $("#allDone").classList.add("hidden");
  }
}

function startRestTimer(){
  clearInterval(state.restTimerInterval);
  state.restStartTs = Date.now();
  const el = $("#restTimer");
  el.textContent = "Pause: 00:00";
  state.restTimerInterval = setInterval(()=>{
    const diff = Date.now() - state.restStartTs;
    el.textContent = "Pause: " + fmtTime(diff);
  }, 500);
}

// ---- Exercise Detail ----
function openExercise(exId){
  state.currentExerciseId = exId;

  const ex = getExercise(exId);
  $("#exerciseName").textContent = ex?.name ?? "Übung";
  const last = lastLogForExercise(exId);
  const input = $("#loadInput");
  input.value = last?.load ?? "";

  $$(".diff-btn").forEach(btn=>{ btn.dataset.selected = "false"; });
  if (last?.difficulty){
    const btn = $(`.diff-btn[data-val="${last.difficulty}"]`);
    if (btn) btn.dataset.selected = "true";
  }

  $("#timerUI").classList.add("hidden");
  $("#saveAndNextBtn").classList.add("hidden");
  $("#startExerciseBtn").classList.remove("hidden"); // sichtbar je Übung genau 1x

  showScreen("screen-exercise");
}

$("#backToPickerBtn").addEventListener("click", ()=>{
  showScreen("screen-exercise-picker");
});

// Difficulty segmented
$(".difficulty-row")?.addEventListener?.("click", (e)=>{
  const btn = e.target.closest(".diff-btn");
  if (!btn) return;
  $$(".diff-btn").forEach(b=>b.dataset.selected="false");
  btn.dataset.selected = "true";
});

// ---- WebAudio: Beeps ----
function ensureAudioCtx(){
  if (!state.audioCtx) {
    const ACtx = window.AudioContext || window.webkitAudioContext;
    if (ACtx) state.audioCtx = new ACtx();
  }
  if (state.audioCtx && state.audioCtx.state === "suspended") {
    state.audioCtx.resume().catch(()=>{});
  }
}
function beep({freq=880, duration=120, type="sine", vol=0.2}={}){
  const withSound = $("#withSound")?.checked;
  if (!withSound || !state.audioCtx) return;
  const ctx = state.audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration/1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration/1000 + 0.02);
}

// Übung starten → Button ausblenden + AudioCtx aktivieren + Timer starten
document.getElementById("startExerciseBtn").addEventListener("click", () => {
  document.getElementById("startExerciseBtn").classList.add("hidden");
  ensureAudioCtx();
  startExerciseTimer();
});

// 3s countdown, dann 10 Reps: up 5s (green), down 5s (red)
async function startExerciseTimer(){
  const countdown = $("#countdown");
  const repCounter = $("#repCounter");
  const phaseNumber = $("#phaseNumber");
  const phaseText = $("#repPhase");

  $("#timerUI").classList.remove("hidden");
  $("#saveAndNextBtn").classList.add("hidden");

  for (let c=3;c>=1;c--){
    phaseNumber.textContent = "–";
    countdown.textContent = String(c);
    phaseText.textContent = "Bereit …";
    repCounter.textContent = "0 / 10";
    await wait(1000);
  }
  countdown.textContent = "GO";
  beep({freq:900, duration:100, type:"sine"});

  for (let rep=1;rep<=10;rep++){
    repCounter.textContent = `${rep} / 10`;

    // up 1..5 (green)
    phaseText.textContent = "Hoch";
    phaseNumber.classList.remove("down");
    phaseNumber.classList.add("up");
    beep({freq:880, duration:120, type:"sine"});
    for (let i=1;i<=5;i++){
      phaseNumber.textContent = String(i);
      await wait(1000);
    }

    // down 5..1 (red)
    phaseText.textContent = "Runter";
    phaseNumber.classList.remove("up");
    phaseNumber.classList.add("down");
    beep({freq:550, duration:120, type:"sine"});
    for (let i=5;i>=1;i--){
      phaseNumber.textContent = String(i);
      await wait(1000);
    }
  }

  countdown.textContent = "Fertig!";
  phaseText.textContent = "Done";
  $("#saveAndNextBtn").classList.remove("hidden");
}

function wait(ms){ return new Promise(res=>setTimeout(res, ms)); }

$("#saveAndNextBtn").addEventListener("click", ()=>{
  const exId = state.currentExerciseId;
  const load = $("#loadInput").value.trim();
  const diffBtn = $$(".diff-btn").find(b=>b.dataset.selected==="true");
  const difficulty = diffBtn ? diffBtn.dataset.val : "OK";

  const logs = loadJSON(LS_KEYS.LOGS, []);
  logs.push({
    id: "log_" + Date.now(),
    date: new Date().toISOString(),
    trainingId: state.session.trainingId,
    exerciseId: exId,
    load,
    difficulty,
  });
  saveJSON(LS_KEYS.LOGS, logs);

  const idx = state.session.exerciseQueue.indexOf(exId);
  if (idx >= 0) state.session.exerciseQueue.splice(idx,1);

  const ex = getExercise(exId);
  state.session.results.push({ name: ex?.name ?? exId, load, difficulty });

  startRestTimer();
  renderExercisePicker();
  showScreen("screen-exercise-picker");
});

$("#endSessionBtn").addEventListener("click", ()=>{
  state.session = null;
  clearInterval(state.restTimerInterval);
  renderDashboard();
  showScreen("screen-dashboard");
});

// ---- MENU NAV ----
$("#menuBtn").addEventListener("click", ()=> showScreen("screen-menu"));
$("#backToDashboardBtn").addEventListener("click", ()=> showScreen("screen-dashboard"));
$$(".to-menu").forEach(btn=>btn.addEventListener("click", ()=>showScreen("screen-menu")));
$$(".menu-list .list-btn[data-target]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const target = btn.getAttribute("data-target");
    if (target) {
      if (target === "screen-rotation") renderRotation();
      if (target === "screen-trainings") renderTrainings();
      if (target === "screen-exercises") renderExercises();
      if (target === "screen-history") renderHistoryInit();
      showScreen(target);
    }
  });
});

// ---- Rotation Screen ----
function renderRotation(){
  const trainings = loadJSON(LS_KEYS.TRAININGS, []);
  const rot = loadJSON(LS_KEYS.ROTATION, {});
  const opts = trainings.map(t=>`<option value="${t.id}">${t.title}</option>`).join("");
  $("#rotT1").innerHTML = opts; $("#rotT1").value = rot.t1 || "";
  $("#rotT2").innerHTML = opts; $("#rotT2").value = rot.t2 || "";
  $("#rotT3").innerHTML = opts; $("#rotT3").value = rot.t3 || "";
  $("#rotT4").innerHTML = opts; $("#rotT4").value = rot.t4 || "";
}
$("#saveRotationBtn").addEventListener("click", ()=>{
  const newRot = {
    t1: $("#rotT1").value,
    t2: $("#rotT2").value,
    t3: $("#rotT3").value,
    t4: $("#rotT4").value,
  };
  saveJSON(LS_KEYS.ROTATION, newRot);
  alert("Rotation gespeichert");
});

// ---- Trainings Screen ----
function renderTrainings(){
  const trainings = loadJSON(LS_KEYS.TRAININGS, []);
  const exs = loadJSON(LS_KEYS.EXERCISES, []).filter(e=>!e.archived);
  const list = $("#trainingList");
  list.innerHTML = "";

  trainings.forEach(tr=>{
    const div = document.createElement("div");
    div.className = "item";
    const exList = tr.exerciseIds.map(id=>{
      const e = exs.find(x=>x.id===id) || getExercise(id);
      return `<span class="pill">${e?.name ?? id}</span>`;
    }).join(" ");

    div.innerHTML = `
      <div class="row"><strong>${tr.title}</strong></div>
      <div class="row">${exList || "<em>Keine Übungen</em>"}</div>
      <div class="row">
        <input class="input" value="${tr.title}" data-edit-title="${tr.id}" />
      </div>
      <div class="row">
        <select class="select" data-add-ex="${tr.id}">
          <option value="">Übung hinzufügen…</option>
          ${exs.map(e=>`<option value="${e.id}">${e.name} (${e.class})</option>`).join("")}
        </select>
      </div>
      <div class="row">
        <button class="secondary-btn" data-save="${tr.id}">Speichern</button>
        <button class="secondary-btn" data-del="${tr.id}">Löschen</button>
      </div>
    `;
    list.appendChild(div);
  });

  list.querySelectorAll("[data-add-ex]").forEach(sel=>{
    sel.addEventListener("change", ()=>{
      const id = sel.getAttribute("data-add-ex");
      const addId = sel.value;
      if (!addId) return;
      const trainings = loadJSON(LS_KEYS.TRAININGS, []);
      const t = trainings.find(x=>x.id===id);
      if (!t.exerciseIds.includes(addId)) t.exerciseIds.push(addId);
      saveJSON(LS_KEYS.TRAININGS, trainings);
      renderTrainings();
    });
  });

  list.querySelectorAll("[data-save]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-save");
      const trainings = loadJSON(LS_KEYS.TRAININGS, []);
      const t = trainings.find(x=>x.id===id);
      const titleInput = list.querySelector(`[data-edit-title="${id}"]`);
      t.title = titleInput.value.trim() || t.title;
      saveJSON(LS_KEYS.TRAININGS, trainings);
      renderTrainings();
    });
  });

  list.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      if (!confirm("Training wirklich löschen?")) return;
      let trainings = loadJSON(LS_KEYS.TRAININGS, []);
      trainings = trainings.filter(x=>x.id!==btn.getAttribute("data-del"));
      saveJSON(LS_KEYS.TRAININGS, trainings);
      renderTrainings();
    });
  });
}

$("#createTrainingBtn").addEventListener("click", ()=>{
  const title = $("#newTrainingTitle").value.trim();
  if (!title) return alert("Titel eingeben.");
  const trainings = loadJSON(LS_KEYS.TRAININGS, []);
  trainings.push({ id: "tr_"+Date.now(), title, exerciseIds: [] });
  saveJSON(LS_KEYS.TRAININGS, trainings);
  $("#newTrainingTitle").value = "";
  renderTrainings();
});

// ---- Exercises Screen ----
function renderExercises(){
  const exs = loadJSON(LS_KEYS.EXERCISES, []);
  const list = $("#exerciseList");
  list.innerHTML = "";
  exs.forEach(e=>{
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="row"><strong>${e.name}</strong> <span class="pill">${e.class}</span></div>
      <div class="row">
        <input class="input" value="${e.name}" data-ex-name="${e.id}" />
        <select class="select" data-ex-class="${e.id}">
          <option value="Push" ${e.class==="Push"?"selected":""}>Push</option>
          <option value="Pull" ${e.class==="Pull"?"selected":""}>Pull</option>
          <option value="Legs" ${e.class==="Legs"?"selected":""}>Legs</option>
          <option value="Core" ${e.class==="Core"?"selected":""}>Core</option>
        </select>
      </div>
      <div class="row">
        <button class="secondary-btn" data-ex-save="${e.id}">Speichern</button>
        <button class="secondary-btn" data-ex-arch="${e.id}">${e.archived?"Entarchivieren":"Archivieren"}</button>
        <button class="secondary-btn" data-ex-history="${e.id}">Verlauf</button>
      </div>
    `;
    list.appendChild(div);
  });

  list.querySelectorAll("[data-ex-save]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-ex-save");
      const exs = loadJSON(LS_KEYS.EXERCISES, []);
      const ex = exs.find(x=>x.id===id);
      const name = list.querySelector(`[data-ex-name="${id}"]`).value.trim();
      const cls = list.querySelector(`[data-ex-class="${id}"]`).value;
      ex.name = name || ex.name;
      ex.class = cls;
      saveJSON(LS_KEYS.EXERCISES, exs);
      renderExercises();
    });
  });

  list.querySelectorAll("[data-ex-arch]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-ex-arch");
      const exs = loadJSON(LS_KEYS.EXERCISES, []);
      const ex = exs.find(x=>x.id===id);
      ex.archived = !ex.archived;
      saveJSON(LS_KEYS.EXERCISES, exs);
      renderExercises();
    });
  });

  list.querySelectorAll("[data-ex-history]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-ex-history");
      openHistoryTable(id);
    });
  });
}

$("#createExerciseBtn").addEventListener("click", ()=>{
  const name = $("#newExerciseName").value.trim();
  const cls = $("#newExerciseClass").value;
  if (!name) return alert("Name eingeben.");
  const exs = loadJSON(LS_KEYS.EXERCISES, []);
  exs.push({ id: "ex_"+Date.now(), name, class: cls, mode: "custom", archived: false });
  saveJSON(LS_KEYS.EXERCISES, exs);
  $("#newExerciseName").value = "";
  renderExercises();
});

// ---- History: Tabelle ----
function renderHistoryInit(){
  const exs = loadJSON(LS_KEYS.EXERCISES, []);
  const select = $("#historyExerciseSelect");
  select.innerHTML = exs.map(e=>`<option value="${e.id}">${e.name}</option>`).join("");
  select.onchange = ()=> openHistoryTable(select.value);
  if (exs[0]) openHistoryTable(exs[0].id);
}

function openHistoryTable(exId){
  // Screen anzeigen
  showScreen("screen-history");

  // Select korrekt setzen
  const select = $("#historyExerciseSelect");
  if (select.value !== exId) select.value = exId;

  // Logs holen & rendern
  const logs = loadJSON(LS_KEYS.LOGS, []).filter(l=>l.exerciseId===exId)
    .sort((a,b)=> new Date(b.date) - new Date(a.date)); // neueste oben

  const tbody = $("#historyTbody");
  if (!logs.length){
    tbody.innerHTML = `<tr><td colspan="2" style="color:var(--muted);padding:12px">Noch keine Einträge.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l=>{
    const diffClass = l.difficulty==="Hard" ? "badge-hard" : (l.difficulty==="Easy" ? "badge-easy" : "badge-ok");
    const loadTxt = l.load && l.load.trim().length ? l.load : "—";
    return `
      <tr>
        <td>${fmtDate(l.date)}</td>
        <td><span class="badge ${diffClass}">${loadTxt}</span></td>
      </tr>
    `;
  }).join("");
}

// ---- Export / Import ----
$("#exportBtn").addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify({
    exercises: loadJSON(LS_KEYS.EXERCISES, []),
    trainings: loadJSON(LS_KEYS.TRAININGS, []),
    rotation: loadJSON(LS_KEYS.ROTATION, {}),
    logs: loadJSON(LS_KEYS.LOGS, []),
    meta: loadJSON(LS_KEYS.META, {}),
  }, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `training-log-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$("#importFile").addEventListener("change", (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const data = JSON.parse(reader.result);
      if (data.exercises) saveJSON(LS_KEYS.EXERCISES, data.exercises);
      if (data.trainings) saveJSON(LS_KEYS.TRAININGS, data.trainings);
      if (data.rotation) saveJSON(LS_KEYS.ROTATION, data.rotation);
      if (data.logs) saveJSON(LS_KEYS.LOGS, data.logs);
      if (data.meta) saveJSON(LS_KEYS.META, data.meta);
      alert("Import erfolgreich. App neu laden.");
    }catch(err){
      alert("Import fehlgeschlagen.");
    }
  };
  reader.readAsText(file);
});

// ---- Init ----
ensureDefaults();
renderDashboard();
showScreen("screen-dashboard");
