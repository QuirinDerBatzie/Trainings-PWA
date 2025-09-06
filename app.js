/* ============
   Training Log PWA – App Logic
   ============ */

// ---- Storage helpers (LocalStorage, simpel & robust) ----
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

// ---- Default Data (preload from our plan) ----
function ensureDefaults() {
  const meta = loadJSON(LS_KEYS.META, {});
  if (meta.version === 1) return;

  // Exercises (each as separate item with Name + Class)
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

  const rotation = {
    t1: "tr_gym1", // 1-7
    t2: "tr_bbw1", // 8-14
    t3: "tr_gym2", // 15-21
    t4: "tr_bbw2", // 22-end
  };

  saveJSON(LS_KEYS.EXERCISES, exercises);
  saveJSON(LS_KEYS.TRAININGS, trainings);
  saveJSON(LS_KEYS.ROTATION, rotation);
  saveJSON(LS_KEYS.LOGS, []);
  saveJSON(LS_KEYS.META, { version: 1, createdAt: new Date().toISOString() });
}

// ---- State ----
let state = {
  currentTrainingId: null,
  session: null, // {trainingId, exerciseQueue, done:[], startedAt}
  currentExerciseId: null,
  lastDifficultyForExercise: {}, // cache UI state
  restTimerInterval: null,
  restStartTs: null,
  historyChart: null,
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
  const heading = $("#todayTrainingHeading");
  heading.textContent = "Heute: " + getTrainingLabel(todayId);
  state.currentTrainingId = todayId;

  // Override dropdown
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
    results: [], // for summary
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
  const { exerciseQueue, done } = state.session;

  // Buttons
  exerciseQueue.forEach(id=>{
    const ex = getExercise(id);
    const btn = document.createElement("button");
    btn.className = "primary-btn";
    btn.textContent = ex?.name ?? id;
    btn.addEventListener("click", ()=> openExercise(id));
    // if done already (shouldn't happen here), gray out
    wrap.appendChild(btn);
  });

  // Done state?
  if (state.session.exerciseQueue.length === 0){
    $("#allDone").classList.remove("hidden");
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

  // difficulty buttons
  $$(".diff-btn").forEach(btn=>{
    btn.dataset.selected = "false";
  });
  if (last?.difficulty){
    const btn = $(`.diff-btn[data-val="${last.difficulty}"]`);
    if (btn) btn.dataset.selected = "true";
  }

  $("#timerUI").classList.add("hidden");
  $("#saveAndNextBtn").classList.add("hidden");
  showScreen("screen-exercise");
}

$("#backToPickerBtn").addEventListener("click", ()=>{
  showScreen("screen-exercise-picker");
});

$(".difficulty-row")?.addEventListener?.("click", (e)=>{
  const btn = e.target.closest(".diff-btn");
  if (!btn) return;
  $$(".diff-btn").forEach(b=>b.dataset.selected="false");
  btn.dataset.selected = "true";
});

$("#startExerciseBtn").addEventListener("click", startExerciseTimer);

function playBeep(which){
  const withSound = $("#withSound").checked;
  if (!withSound) return;
  const el = which==="hi" ? $("#beepHi") : $("#beepLo");
  el.currentTime = 0;
  el.play().catch(()=>{ /* ignore autoplay restrictions */ });
}

// 3s countdown, then 10 reps: up 5s (green), down 5s (red)
async function startExerciseTimer(){
  const countdown = $("#countdown");
  const repCounter = $("#repCounter");
  const phaseNumber = $("#phaseNumber");
  const phaseText = $("#repPhase");
  $("#timerUI").classList.remove("hidden");
  $("#saveAndNextBtn").classList.add("hidden");

  // 3..2..1
  for (let c=3;c>=1;c--){
    countdown.textContent = String(c);
    phaseText.textContent = "Bereit …";
    phaseNumber.textContent = "–";
    await wait(1000);
  }
  countdown.textContent = "GO";

  // 10 reps
  for (let rep=1;rep<=10;rep++){
    repCounter.textContent = `${rep} / 10`;

    // up 1..5 (green)
    phaseText.textContent = "Hoch";
    phaseNumber.classList.remove("down");
    phaseNumber.classList.add("up");
    playBeep("hi");
    for (let i=1;i<=5;i++){
      phaseNumber.textContent = String(i);
      await wait(1000);
    }

    // down 5..1 (red)
    phaseText.textContent = "Runter";
    phaseNumber.classList.remove("up");
    phaseNumber.classList.add("down");
    playBeep("lo");
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

  // Save log
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

  // Remove exercise from queue, add to done
  const idx = state.session.exerciseQueue.indexOf(exId);
  if (idx >= 0) state.session.exerciseQueue.splice(idx,1);

  // For summary
  const ex = getExercise(exId);
  state.session.results.push({
    name: ex?.name ?? exId,
    load, difficulty
  });

  // Back to picker
  startRestTimer();
  renderExercisePicker();

  // Summary check
  if (state.session.exerciseQueue.length === 0){
    const s = $("#sessionSummary");
    s.innerHTML = state.session.results.map(r=>(
      `<div class="row">
        <span class="pill">${r.name}</span>
        <span class="pill">${r.load||"—"}</span>
        <span class="pill">${r.difficulty}</span>
      </div>`
    )).join("");
  }
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
      openHistory(id);
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

// ---- History (Chart) ----
function openHistory(exId){
  const select = $("#historyExerciseSelect");
  const exs = loadJSON(LS_KEYS.EXERCISES, []);
  select.innerHTML = exs.map(e=>`<option value="${e.id}" ${e.id===exId?"selected":""}>${e.name}</option>`).join("");
  select.onchange = ()=> drawHistory(select.value);
  drawHistory(exId);
  showScreen("screen-history");
}

function drawHistory(exId){
  const ctx = $("#historyChart").getContext("2d");
  const logs = loadJSON(LS_KEYS.LOGS, []).filter(l=>l.exerciseId===exId);
  // parse numeric "load": erste Zahl in load-string
  const data = logs.map(l=>{
    const m = (l.load||"").match(/-?\d+(\.\d+)?/);
    const num = m ? parseFloat(m[0]) : null;
    return { x: new Date(l.date), y: num, difficulty: l.difficulty, load: l.load };
  }).filter(p=>p.y!==null).sort((a,b)=>a.x-b.x);

  const colors = { Easy: "#26d07c", OK: "#ffc857", Hard: "#ff5a5f" };
  const pointStyles = data.map(p=> ({ backgroundColor: colors[p.difficulty] || "#2f80ed" }));

  if (state.historyChart) { state.historyChart.destroy(); }
  state.historyChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [{
        label: "Load",
        data: data,
        parsing: false,
        borderColor: "#2f80ed",
        pointBackgroundColor: data.map(p=>colors[p.difficulty]||"#2f80ed"),
        pointRadius: 4,
        borderWidth: 2,
        tension: 0.2,
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: { type: "time", time: { unit: "day" }, ticks: { color: "#a9afbd" }, grid: { color: "#222632" } },
        y: { ticks: { color: "#a9afbd" }, grid: { color: "#222632" } }
      },
      plugins: {
        legend: { labels: { color: "#a9afbd" } },
        tooltip: {
          callbacks: {
            label: (ctx)=> {
              const p = data[ctx.dataIndex];
              return ` ${p.y} ( ${p.load} · ${p.difficulty} )`;
            }
          }
        }
      }
    }
  });
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
