
let currentSeriesIndex = null;
let currentEventIndex = null;
let timelineData = null;

export function renderTimeline(program) {
  const timeline = document.getElementById("timeline");
  timeline.innerHTML = "";

  timelineData = preprocess(program.series);

  timelineData.forEach((series, sIdx) => {
    const wrapper = document.createElement("div");
    wrapper.className = "series";
    if (series.optional) wrapper.classList.add("optional");
    wrapper.dataset.seriesIndex = sIdx;

    const title = document.createElement("div");
    title.textContent = series.name;
    wrapper.appendChild(title);

    const row = document.createElement("div");
    row.className = "events";

    series.events.forEach((ev, eIdx) => {
      const evDiv = document.createElement("div");
      evDiv.className = "event";
      evDiv.dataset.eventIndex = eIdx;

      const dur = document.createElement("div");
      dur.className = "dur";
      dur.textContent = ev.duration.toFixed(1);
      evDiv.appendChild(dur);

      const sym = document.createElement("div");
      sym.className = "symbol " + ev.symbol;
      sym.textContent = ev.symbol === "A" ? "A" : "";
      evDiv.appendChild(sym);

      const acc = document.createElement("div");
      acc.className = "acc";
      acc.textContent = ev.acc.toFixed(1);
      evDiv.appendChild(acc);

      row.appendChild(evDiv);
    });

    wrapper.appendChild(row);
    timeline.appendChild(wrapper);
  });
}

function preprocess(seriesList) {
  return seriesList.map((series) => {
    let acc = 0;
    const events = series.events.map(ev => {
      const duration = ev.duration / 10;
      let symbol = "empty";
      if ("audio_id" in ev) symbol = "A";
      if (ev.command === "show") symbol = "filled";
      const entry = { ...ev, duration, acc, symbol };
      acc += duration;
      return entry;
    });
    return { ...series, events };
  });
}

export function setCurrent(si, ei) {
  currentSeriesIndex = si;
  currentEventIndex = ei;

  document.querySelectorAll(".series").forEach(s => s.classList.remove("current"));
  document.querySelectorAll(".event").forEach(e => e.classList.remove("current"));

  const currentSeries = document.querySelector(`[data-series-index='${si}']`);
  if (currentSeries) {
    currentSeries.classList.add("current");
    const currentEvent = currentSeries.querySelector(`[data-event-index='${ei}']`);
    if (currentEvent) currentEvent.classList.add("current");
  }
}

export function clearCurrent() {
  currentSeriesIndex = null;
  currentEventIndex = null;
  document.querySelectorAll(".series").forEach(s => s.classList.remove("current"));
  document.querySelectorAll(".event").forEach(e => e.classList.remove("current"));
}

export function toggleRaw(program) {
  const raw = document.getElementById("raw");
  raw.style.display = raw.style.display === "none" ? "block" : "none";
  if (!raw.textContent) {
    raw.textContent = JSON.stringify(program, null, 2);
  }
}
